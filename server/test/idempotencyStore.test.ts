import { describe, it, expect, vi, beforeEach } from "vitest";

/** The real Firestore-backed store (setup.ts mocks it for every other test). */
const docs = new Map<string, any>();
const docIds: string[] = [];
vi.mock("../services/firebaseAdmin", () => ({
  getAdminFirestore: () => ({
    collection: (name: string) => ({
      doc: (id: string) => {
        docIds.push(`${name}/${id}`);
        return {
          get: async () => ({ exists: docs.has(id), data: () => docs.get(id) }),
          set: async (data: any) => { docs.set(id, data); },
        };
      },
    }),
  }),
}));

const { getStoredResult, storeResult, DURABLE_TTL_MS } = await vi.importActual<typeof import("../services/idempotencyStore")>("../services/idempotencyStore");

describe("idempotencyStore", () => {
  beforeEach(() => {
    docs.clear();
    docIds.length = 0;
  });

  it("round-trips a result under a hashed document id (keys can contain '/')", async () => {
    await storeResult("auction/record-winning-bid:abc", { success: true, followUpAdded: false }, 1000);

    expect(docIds[0]).toMatch(/^idempotency\/[0-9a-f]{64}$/);
    const stored = [...docs.values()][0];
    expect(stored.key).toBe("auction/record-winning-bid:abc");
    expect(stored.expireAt).toEqual(new Date(1000 + DURABLE_TTL_MS));
    expect(await getStoredResult("auction/record-winning-bid:abc", 2000)).toEqual({ result: { success: true, followUpAdded: false } });
  });

  it("ignores a record past its expiry, since Firestore's TTL deletion can lag", async () => {
    await storeResult("s:k", { ok: true }, 0);
    expect(await getStoredResult("s:k", DURABLE_TTL_MS + 1)).toBeUndefined();
  });

  it("reads a Firestore Timestamp expiry", async () => {
    await storeResult("s:k", { ok: true }, 0);
    const stored = [...docs.values()][0];
    stored.expireAt = { toMillis: () => 5000 };
    expect(await getStoredResult("s:k", 4000)).toEqual({ result: { ok: true } });
    expect(await getStoredResult("s:k", 6000)).toBeUndefined();
  });

  it("returns undefined for a key it has never seen", async () => {
    expect(await getStoredResult("s:missing")).toBeUndefined();
  });
});
