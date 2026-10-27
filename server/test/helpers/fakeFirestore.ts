/**
 * A small in-memory stand-in for the firebase-admin Firestore calls this
 * app makes: collection().doc(id?).get/set(merge)/delete, and
 * collection().where(field, "==" | "in", value).limit(n).get(). Use with
 * `vi.mock("../services/firebaseAdmin", () => ({ getAdminFirestore: () => fake.db }))`.
 */
export function createFakeFirestore() {
  const data = new Map<string, Map<string, Record<string, any>>>();
  let nextId = 1;
  const coll = (name: string) => {
    if (!data.has(name)) data.set(name, new Map());
    return data.get(name)!;
  };

  const docRef = (name: string, id: string) => ({
    id,
    get: async () => {
      const d = coll(name).get(id);
      return { id, exists: d !== undefined, data: () => (d ? { ...d } : undefined), ref: docRef(name, id) };
    },
    set: async (value: Record<string, any>, opts?: { merge?: boolean }) => {
      coll(name).set(id, opts?.merge ? { ...(coll(name).get(id) || {}), ...value } : { ...value });
    },
    delete: async () => {
      coll(name).delete(id);
    },
  });

  type Filter = (d: Record<string, any>) => boolean;
  const query = (name: string, filters: Filter[], max = Infinity) => ({
    where: (field: string, op: "==" | "in", value: any) =>
      query(name, [...filters, (d) => (op === "in" ? value.includes(d[field]) : d[field] === value)], max),
    limit: (n: number) => query(name, filters, n),
    get: async () => {
      const docs = [...coll(name).entries()]
        .filter(([, d]) => filters.every((f) => f(d)))
        .slice(0, max)
        .map(([id, d]) => ({ id, data: () => ({ ...d }), ref: docRef(name, id) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  });

  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id ?? `auto-${nextId++}`),
      ...query(name, []),
    }),
  };

  return {
    db,
    /** The stored documents of one collection, by ID. */
    docs: (name: string) => coll(name),
    clear: () => data.clear(),
  };
}
