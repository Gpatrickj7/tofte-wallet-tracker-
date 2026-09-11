// Storage: MongoDB Atlas. MONGODB_URI required.
import { MongoClient, type Db } from "mongodb";

export type Payout = {
  id: string; ts: number; asset: string; amount_base: string; decimals: number;
  usd_price: string | null; usd_value: string | null; price_error: string | null; source?: string;
};
export type Purchase = {
  id: string; date: string; asset: string; quantity: string; usd_total: string;
  fees: string; rail: string; notes: string | null; created_at: number;
};
type CacheRow = { key: string; value: string; fetched_at: number };

let dbp: Promise<Db> | null = null;
function db(): Promise<Db> {
  if (!dbp) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("MONGODB_URI not set");
    dbp = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, connectTimeoutMS: 5000, socketTimeoutMS: 10000 }).connect().then(async (c) => {
      const d = c.db(process.env.MONGODB_DB || "wallet_tracker");
      await d.collection("payouts").createIndex({ id: 1 }, { unique: true });
      await d.collection("price_cache").createIndex({ key: 1 }, { unique: true });
      await d.collection("snapshots").createIndex({ day: 1 }, { unique: true });
      return d;
    }).catch((e) => { dbp = null; throw e; });
  }
  return dbp;
}

export async function dbStatus(): Promise<{ ok: boolean; ms: number; error: string | null }> {
  const t = Date.now();
  try { await (await db()).command({ ping: 1 }); return { ok: true, ms: Date.now() - t, error: null }; }
  catch (e) { return { ok: false, ms: Date.now() - t, error: (e as Error).message }; }
}
const strip = <T>(doc: unknown): T => { const { _id, ...rest } = doc as { _id?: unknown } & T; return rest as T; };

export const payouts = {
  list: async (): Promise<Payout[]> => (await (await db()).collection("payouts").find().sort({ ts: -1 }).toArray()).map((d) => strip<Payout>(d)),
  get: async (id: string): Promise<Payout | null> => { const d = await (await db()).collection("payouts").findOne({ id }); return d ? strip<Payout>(d) : null; },
  insert: async (p: Payout) => { await (await db()).collection("payouts").updateOne({ id: p.id }, { $setOnInsert: p }, { upsert: true }); },
  // Snapshot semantics: only fills in a missing price, never overwrites one.
  setPrice: async (id: string, usd_price: string | null, usd_value: string | null, price_error: string | null) => {
    await (await db()).collection("payouts").updateOne({ id, usd_price: null }, { $set: { usd_price, usd_value, price_error } });
  },
  setSource: async (id: string, source: string) => { await (await db()).collection("payouts").updateOne({ id }, { $set: { source } }); },
  unpriced: async (limit: number): Promise<Payout[]> => (await (await db()).collection("payouts").find({ usd_price: null }).sort({ ts: 1 }).limit(limit).toArray()).map((d) => strip<Payout>(d)),
};

export const purchases = {
  list: async (): Promise<Purchase[]> => (await (await db()).collection("purchases").find().sort({ date: -1, created_at: -1 }).toArray())
    .map((d) => ({ ...strip<Omit<Purchase, "id">>(d), id: String(d._id) })),
  insert: async (p: Omit<Purchase, "id">) => { await (await db()).collection("purchases").insertOne(p); },
};

// A swap: units of one asset out, units of another in, at a dollar value.
// Logged by hand, like a purchase. The ledger moves basis across it.
export type Swap = {
  id: string; date: string; from_asset: string; from_qty: string; to_asset: string; to_qty: string;
  usd_value: string; fees: string; venue: string; notes: string | null; created_at: number;
};
export const swaps = {
  list: async (): Promise<Swap[]> => (await (await db()).collection("swaps").find().sort({ date: -1, created_at: -1 }).toArray())
    .map((d) => ({ ...strip<Omit<Swap, "id">>(d), id: String(d._id) })),
  insert: async (s: Omit<Swap, "id">) => { await (await db()).collection("swaps").insertOne(s); },
};

// One row per UTC day holding the portfolio's priced total and, since v1.1,
// each priced position behind it. Written on each holdings load, last write
// of the day wins. Balances alone have no memory; this is what makes the
// value-over-time and composition charts possible. Rows written by v1 have
// no positions and are simply skipped by the composition chart.
export type SnapPosition = { asset: string; chain: string; qty: string; price: number | null; value: number };
export type Snapshot = { day: string; ts: number; total: number; positions?: SnapPosition[] };
export const snapshots = {
  record: async (total: number, positions: SnapPosition[] = []) => {
    try {
      const d = await db();
      await d.collection("snapshots").updateOne(
        { day: new Date().toISOString().slice(0, 10) },
        { $set: { ts: Math.floor(Date.now() / 1000), total, positions } },
        { upsert: true },
      );
    } catch { /* best-effort: the page must render without storage */ }
  },
  // The most recent `days` rows, oldest first. Sorted descending first so
  // the limit trims the far past rather than the recent past.
  list: async (days = 365): Promise<Snapshot[]> => {
    try { return (await (await db()).collection("snapshots").find().sort({ day: -1 }).limit(days).toArray()).map((d) => strip<Snapshot>(d)).reverse(); }
    catch { return []; }
  },
};

export const cache = {
  get: async (key: string): Promise<CacheRow | null> => { try { const d = await (await db()).collection("price_cache").findOne({ key }); return d ? strip<CacheRow>(d) : null; } catch { return null; } },
  set: async (key: string, value: string, fetched_at: number) => { try { await (await db()).collection("price_cache").updateOne({ key }, { $set: { key, value, fetched_at } }, { upsert: true }); } catch { /* cache is best-effort */ } },
};
