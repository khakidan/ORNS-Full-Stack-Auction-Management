/**
 * A small in-memory stand-in for the firebase-admin Firestore calls this
 * app makes: collection().doc(id?).get/set(merge)/delete, and
 * collection().where(field, "==" | "in", value).limit(n).get(), and
 * runTransaction(tx => ...) with tx.get/set/update/delete. Use with
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
    update: async (value: Record<string, any>) => {
      if (!coll(name).has(id)) throw new Error(`NOT_FOUND: ${name}/${id}`);
      coll(name).set(id, { ...coll(name).get(id), ...value });
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

  // Transactions run one at a time, so a read-then-write inside one can't
  // interleave with another (as Firestore's would retry on contention).
  let txChain: Promise<unknown> = Promise.resolve();
  type Ref = ReturnType<typeof docRef>;
  const runTransaction = <T>(fn: (tx: any) => Promise<T>): Promise<T> => {
    const run = txChain.then(() => {
      const writes: (() => Promise<void>)[] = [];
      const tx = {
        get: (ref: Ref) => ref.get(),
        set: (ref: Ref, value: Record<string, any>, opts?: { merge?: boolean }) => writes.push(() => ref.set(value, opts)),
        update: (ref: Ref, value: Record<string, any>) => writes.push(() => ref.update(value)),
        delete: (ref: Ref) => writes.push(() => ref.delete()),
      };
      return fn(tx).then(async (result) => {
        for (const w of writes) await w();
        return result;
      });
    });
    txChain = run.catch(() => {});
    return run;
  };

  const db = {
    collection: (name: string) => ({
      doc: (id?: string) => docRef(name, id ?? `auto-${nextId++}`),
      ...query(name, []),
    }),
    runTransaction,
  };

  return {
    db,
    /** The stored documents of one collection, by ID. */
    docs: (name: string) => coll(name),
    clear: () => data.clear(),
  };
}
