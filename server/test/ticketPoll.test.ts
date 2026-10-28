/**
 * pollTicketPurchases: the safety net under the ticket webhook (ROADMAP
 * W5). upsertTicketPurchase (W2) and checkTicketPayment (W4) have their own
 * tests; here they're spies, to check what the poll hands them and when.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../services/ticketPurchaseService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ticketPurchaseService")>()),
  upsertTicketPurchase: vi.fn(),
}));
vi.mock("../services/ticketPaymentCheck", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/ticketPaymentCheck")>()),
  checkTicketPayment: vi.fn(),
}));

import { pollTicketPurchases, startNewTicketSeason, TicketPollDeps } from "../services/ticketPoll";
import { FluentFormsEntry } from "../services/fluentFormsApi";
import { upsertTicketPurchase } from "../services/ticketPurchaseService";
import { checkTicketPayment } from "../services/ticketPaymentCheck";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { AlreadyRunningError } from "../utils/asyncLock";

const state = () => getAdminFirestore().collection("system").doc("fluentFormsPoll");
const SHEETS = { fake: "sheets" } as any;

const entry = (id: number, overrides: Partial<FluentFormsEntry> = {}): FluentFormsEntry => ({
  id, formId: "7", status: "unread", paymentMethod: "paypal", paymentStatus: "pending", total: 70, createdAt: "2027-02-01 10:00:00",
  response: { names: { first_name: "Pat", last_name: `Lee${id}` }, email: "pat@example.com", phone: "555-0100", payment_input: "2" },
  ...overrides,
});

/** WordPress holding `entries`; Google there unless `google` is false. */
function deps(entries: FluentFormsEntry[], google = true) {
  const d = {
    fluentForms: {
      listEntriesAfter: vi.fn(async (after: number) => entries.filter((e) => e.id > after).sort((a, b) => a.id - b.id)),
      latestEntryId: vi.fn(async () => Math.max(0, ...entries.map((e) => e.id))),
      getEntryPayment: vi.fn(),
    },
    paypal: { getPayment: vi.fn() },
    sheets: vi.fn(async () => (google ? SHEETS : null)),
  };
  return d as typeof d & TicketPollDeps;
}

const savedMode = process.env.FLUENT_FORMS_TICKETS_MODE;
beforeEach(() => {
  process.env.FLUENT_FORMS_TICKETS_MODE = "write";
  vi.mocked(upsertTicketPurchase).mockReset().mockImplementation(async (_s, purchase) => ({ outcome: "added", entryId: purchase.entryId, rowIndex: 9 }));
  vi.mocked(checkTicketPayment).mockReset().mockImplementation(async (_s, entryId) => ({ outcome: "unchanged", entryId, status: "Pending", reason: "Fluent Forms says pending" }));
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  vi.mocked(console.log).mockRestore();
  if (savedMode === undefined) delete process.env.FLUENT_FORMS_TICKETS_MODE;
  else process.env.FLUENT_FORMS_TICKETS_MODE = savedMode;
});

const startAt = (id: number, settled: Record<string, string> = {}) => state().set({ seasonStartEntryId: id, highWaterEntryId: id, settled });

describe("pollTicketPurchases", () => {
  it("on its first run starts the season after the newest entry - last year's purchases are never added", async () => {
    const d = deps([entry(1424, { paymentStatus: "paid" }), entry(1482)]);

    const run = await pollTicketPurchases(d);

    expect(run).toMatchObject({ started: 1482, newEntries: 0, added: [], errors: [] });
    expect(upsertTicketPurchase).not.toHaveBeenCalled();
    expect(checkTicketPayment).not.toHaveBeenCalled();
    expect((await state().get()).data()).toMatchObject({ seasonStartEntryId: 1482, highWaterEntryId: 1482 });
  });

  it("adds each entry after the mark, oldest first, and moves the mark past it", async () => {
    await startAt(1482);
    const d = deps([entry(1482), entry(1484, { paymentMethod: "test" }), entry(1483)]);

    const run = await pollTicketPurchases(d);

    expect(vi.mocked(upsertTicketPurchase).mock.calls.map(([, p]) => p.entryId)).toEqual(["1483", "1484"]);
    expect(vi.mocked(upsertTicketPurchase).mock.calls[0][1]).toMatchObject({ firstName: "Pat", lastName: "Lee1483", tickets: 2, total: 70 });
    expect(vi.mocked(upsertTicketPurchase).mock.calls[0][2]).toEqual({ mode: "write" });
    expect(run).toMatchObject({ newEntries: 2, added: ["1483", "1484"], errors: [] });
    expect((await state().get()).data()).toMatchObject({ highWaterEntryId: 1484, lastSuccessAt: run.at });
  });

  it("checks a new PayPal purchase's payment, but not cash/check", async () => {
    await startAt(1482);
    const d = deps([entry(1483), entry(1484, { paymentMethod: "test" })]);

    await pollTicketPurchases(d);

    expect(vi.mocked(checkTicketPayment).mock.calls.map(([, id, opts]) => [id, opts.mode])).toEqual([["1483", "write"]]);
  });

  it("stops at an entry it can't handle and starts there next time - nothing is skipped", async () => {
    await startAt(1482);
    const d = deps([entry(1483), entry(1484), entry(1485)]);
    vi.mocked(upsertTicketPurchase).mockImplementation(async (_s, p) => {
      if (p.entryId === "1484") throw new Error("Sheets said no");
      return { outcome: "added", entryId: p.entryId, rowIndex: 9 };
    });

    const first = await pollTicketPurchases(d);

    expect(first.errors).toEqual(["Sheets said no"]);
    expect(first.added).toEqual(["1483"]);
    const saved = (await state().get()).data();
    expect(saved).toMatchObject({ highWaterEntryId: 1483 });
    expect(saved?.lastSuccessAt).toBeUndefined();

    vi.mocked(upsertTicketPurchase).mockClear().mockImplementation(async (_s, p) => ({ outcome: "added", entryId: p.entryId, rowIndex: 9 }));
    const second = await pollTicketPurchases(d);

    expect(second.added).toEqual(["1484", "1485"]);
  });

  it("skips spam, but moves past it", async () => {
    await startAt(1482);

    const run = await pollTicketPurchases(deps([entry(1483, { status: "spam" })]));

    expect(upsertTicketPurchase).not.toHaveBeenCalled();
    expect(run.spam).toEqual(["1483"]);
    expect((await state().get()).data()).toMatchObject({ highWaterEntryId: 1483 });
  });

  it("with nothing new touches only WordPress - no Google sign-in needed", async () => {
    await startAt(1482);
    const d = deps([entry(1482)], false);

    const run = await pollTicketPurchases(d);

    expect(run.errors).toEqual([]);
    expect(d.sheets).not.toHaveBeenCalled();
  });

  it("reports a missing Google sign-in when there's something to write, and doesn't move the mark", async () => {
    await startAt(1482);

    const run = await pollTicketPurchases(deps([entry(1483)], false));

    expect(run.errors).toEqual([expect.stringContaining("no stored Google sign-in")]);
    expect((await state().get()).data()).toMatchObject({ highWaterEntryId: 1482 });
  });

  it("re-checks an earlier PayPal purchase once Fluent Forms says paid - until it's settled", async () => {
    await startAt(1480);
    await state().set({ highWaterEntryId: 1482 }, { merge: true });
    const d = deps([entry(1481, { paymentStatus: "paid" }), entry(1482, { paymentStatus: "pending" })]);
    vi.mocked(checkTicketPayment).mockResolvedValue({ outcome: "set", entryId: "1481", from: "Pending", to: "Paid", transactionId: "X" });

    const first = await pollTicketPurchases(d);

    expect(first.paymentsSet).toEqual(["1481"]);
    expect(vi.mocked(checkTicketPayment).mock.calls.map(([, id]) => id)).toEqual(["1481"]);

    vi.mocked(checkTicketPayment).mockClear();
    await pollTicketPurchases(d);
    expect(checkTicketPayment).not.toHaveBeenCalled();
  });

  it("checks a settled purchase again when Fluent Forms reports a refund", async () => {
    await startAt(1480, { "1481": "paid" });
    await state().set({ highWaterEntryId: 1481 }, { merge: true });

    await pollTicketPurchases(deps([entry(1481, { paymentStatus: "refunded" })]));

    expect(vi.mocked(checkTicketPayment).mock.calls.map(([, id]) => id)).toEqual(["1481"]);
  });

  it("keeps re-checking a payment on the review list each run, so it clears once fixed", async () => {
    await startAt(1480);
    await state().set({ highWaterEntryId: 1481 }, { merge: true });
    vi.mocked(checkTicketPayment).mockResolvedValue({ outcome: "needs-review", entryId: "1481", problems: ["PayPal has no payment X"] });
    const d = deps([entry(1481, { paymentStatus: "paid" })]);

    expect((await pollTicketPurchases(d)).paymentsNeedReview).toEqual(["1481"]);
    expect((await pollTicketPurchases(d)).paymentsNeedReview).toEqual(["1481"]);
  });

  it("in compare mode (shadow) reports what it would add and still moves the mark - the Sheets feed is the writer", async () => {
    delete process.env.FLUENT_FORMS_TICKETS_MODE;
    await startAt(1482);
    vi.mocked(upsertTicketPurchase).mockImplementation(async (_s, p, { mode }) => {
      expect(mode).toBe("compare");
      return { outcome: "would-add", entryId: p.entryId, row: [] };
    });

    const run = await pollTicketPurchases(deps([entry(1483)]));

    expect(run).toMatchObject({ mode: "compare", wouldAdd: ["1483"], added: [] });
    expect((await state().get()).data()).toMatchObject({ highWaterEntryId: 1483 });
  });

  it("refuses a second run while one is going", async () => {
    await startAt(1482);
    let release!: () => void;
    vi.mocked(upsertTicketPurchase).mockImplementation(() => new Promise((resolve) => { release = () => resolve({ outcome: "added", entryId: "1483", rowIndex: 9 }); }));
    const d = deps([entry(1483)]);

    const first = pollTicketPurchases(d);
    await vi.waitFor(() => expect(upsertTicketPurchase).toHaveBeenCalled());

    await expect(pollTicketPurchases(d)).rejects.toBeInstanceOf(AlreadyRunningError);
    release();
    await first;
  });

  it("logs each run to Cloud Logging", async () => {
    await startAt(1482);
    await pollTicketPurchases(deps([entry(1483)]), "staff: jane@orns.org");
    const line = vi.mocked(console.log).mock.calls.map(([t]) => String(t)).find((t) => t.includes("fluentFormsPoll"));
    expect(JSON.parse(line!).fluentFormsPoll).toMatchObject({ trigger: "staff: jane@orns.org", added: ["1483"] });
    expect(line).not.toContain("Pat");
  });
});

describe("startNewTicketSeason (Setup New Auction Year)", () => {
  const saved = { ...process.env };
  afterEach(() => {
    for (const key of ["FLUENT_FORMS_SITE_URL", "FLUENT_FORMS_API_USER", "FLUENT_FORMS_API_PASSWORD"]) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("without the Fluent Forms API, forgets the old season so the next poll starts a new one", async () => {
    for (const key of ["FLUENT_FORMS_SITE_URL", "FLUENT_FORMS_API_USER", "FLUENT_FORMS_API_PASSWORD"]) delete process.env[key];
    await startAt(1300, { "1301": "paid" });

    expect(await startNewTicketSeason()).toBeNull();
    expect((await state().get()).exists).toBe(false);
  });
});
