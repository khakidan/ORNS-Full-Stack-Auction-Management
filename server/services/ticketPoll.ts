import { google, sheets_v4 } from "googleapis";
import { getAdminFirestore } from "./firebaseAdmin";
import { FluentFormsApi, fluentFormsApiFromEnv, purchaseFromEntry } from "./fluentFormsApi";
import { getSweeperAuthClient } from "./paypalSweeperJob";
import { TicketPaymentDeps, checkTicketPayment, paypalForTickets } from "./ticketPaymentCheck";
import { ticketWriteMode, upsertTicketPurchase } from "./ticketPurchaseService";
import { runIfIdle } from "../utils/asyncLock";

const STATE = () => getAdminFirestore().collection("system").doc("fluentFormsPoll");

/** Fluent Forms payment statuses that can change a PayPal row (W4). */
const SETTLING_STATUSES = new Set(["paid", "refunded", "partially-refunded"]);

export interface TicketPollState {
  /** Entries up to this ID are last year's (or before the poll began) - never added. */
  seasonStartEntryId: number;
  /** Every entry up to this ID has been through upsertTicketPurchase. */
  highWaterEntryId: number;
  /** entry ID -> the Fluent Forms payment status last settled (checkTicketPayment had nothing left to do). */
  settled: Record<string, string>;
  lastSuccessAt?: string;
}

export interface TicketPollRun {
  at: string;
  mode: "write" | "compare";
  trigger: string;
  /** First run, or after Setup New Auction Year: the season starts after this entry. */
  started?: number;
  newEntries: number;
  /** Entry IDs by what upsertTicketPurchase did - each one "added" (or "would-add") is a webhook that was missed. */
  added: string[];
  wouldAdd: string[];
  needsReview: string[];
  /** Entry IDs by what checkTicketPayment did. */
  paymentsSet: string[];
  paymentsWouldSet: string[];
  paymentsNeedReview: string[];
  /** Spam entries skipped. */
  spam: string[];
  errors: string[];
}

export interface TicketPollDeps {
  fluentForms: Pick<FluentFormsApi, "listEntriesAfter" | "latestEntryId" | "getEntryPayment">;
  paypal: TicketPaymentDeps["paypal"];
  /** The server's own Google access, or null when it has no stored sign-in. Only asked for when there's something to write. */
  sheets: () => Promise<sheets_v4.Sheets | null>;
}

async function readState(): Promise<TicketPollState | null> {
  const data = (await STATE().get()).data();
  if (!data || !Number.isFinite(data.highWaterEntryId)) return null;
  return {
    seasonStartEntryId: Number(data.seasonStartEntryId) || 0,
    highWaterEntryId: Number(data.highWaterEntryId),
    settled: data.settled && typeof data.settled === "object" ? data.settled : {},
    lastSuccessAt: data.lastSuccessAt,
  };
}

/**
 * The poll (ROADMAP W5): makes sure no website ticket purchase is missed,
 * whatever happened to its webhook. Cloud Scheduler runs it a few times a
 * day; staff can run it on demand.
 *
 * 1. Every entry after the high-water mark goes through
 *    upsertTicketPurchase (W2), oldest first, and the mark moves past each
 *    one handled - so an outage of any length is caught up next time. An
 *    error stops there; the next run starts from that entry again.
 * 2. Every PayPal entry this season whose Fluent Forms payment status is
 *    paid or refunded, and hasn't been settled at that status, goes
 *    through checkTicketPayment (W4). Cash/check is left to staff.
 *
 * The season starts after the newest entry when the poll first runs (and
 * again after Setup New Auction Year), so last year's purchases are never
 * added to this year's sheet. When there's nothing new it touches only
 * WordPress - no Google, no PayPal - so running all year costs nothing.
 *
 * Follows FLUENT_FORMS_TICKETS_MODE like the webhook: in compare mode it
 * reports and writes nothing (but still moves the mark - the Sheets feed
 * is the writer then).
 */
export async function pollTicketPurchases(deps: TicketPollDeps, trigger = "scheduler"): Promise<TicketPollRun> {
  return runIfIdle("fluent-forms-poll", async () => {
    const mode = ticketWriteMode();
    const run: TicketPollRun = {
      at: new Date().toISOString(), mode, trigger, newEntries: 0,
      added: [], wouldAdd: [], needsReview: [], paymentsSet: [], paymentsWouldSet: [], paymentsNeedReview: [], spam: [], errors: [],
    };

    let state = await readState();
    if (!state) {
      const latest = await deps.fluentForms.latestEntryId();
      state = { seasonStartEntryId: latest, highWaterEntryId: latest, settled: {} };
      run.started = latest;
    }

    const entries = await deps.fluentForms.listEntriesAfter(state.seasonStartEntryId);
    const fresh = entries.filter((e) => e.id > state!.highWaterEntryId);
    run.newEntries = fresh.length;
    const checkedThisRun = new Set<string>();

    let sheets: sheets_v4.Sheets | null | undefined;
    const needSheets = async () => {
      if (sheets === undefined) sheets = await deps.sheets();
      if (!sheets) throw new Error("The server has no stored Google sign-in to write with. A staff member needs to sign in to the app once.");
      return sheets;
    };

    const checkPayment = async (entryId: string, ffStatus: string) => {
      checkedThisRun.add(entryId);
      const result = await checkTicketPayment(await needSheets(), entryId, { mode, fluentForms: deps.fluentForms, paypal: deps.paypal });
      if (result.outcome === "set") run.paymentsSet.push(entryId);
      if (result.outcome === "would-set") run.paymentsWouldSet.push(entryId);
      if (result.outcome === "needs-review") run.paymentsNeedReview.push(entryId);
      const done = result.outcome === "offline" || result.outcome === "set" || (result.outcome === "unchanged" && (result.status === "Paid" || result.status === "Refunded"));
      if (done) state!.settled[entryId] = ffStatus;
    };

    try {
      for (const entry of fresh) {
        const entryId = String(entry.id);
        if (entry.status === "spam") {
          run.spam.push(entryId);
        } else {
          const purchase = purchaseFromEntry(entry);
          if ("error" in purchase) throw new Error(`Entry ${entryId}: ${purchase.error}`);
          const result = await upsertTicketPurchase(await needSheets(), purchase, { mode });
          if (result.outcome === "added") run.added.push(entryId);
          if (result.outcome === "would-add") run.wouldAdd.push(entryId);
          if (result.outcome === "needs-review") run.needsReview.push(entryId);
          if ((result.outcome === "added" || result.outcome === "exists") && entry.paymentMethod === "paypal") {
            await checkPayment(entryId, entry.paymentStatus);
          }
        }
        state.highWaterEntryId = entry.id;
      }

      for (const entry of entries) {
        const entryId = String(entry.id);
        if (entry.id > state.highWaterEntryId || entry.status === "spam" || entry.paymentMethod !== "paypal") continue;
        if (!SETTLING_STATUSES.has(entry.paymentStatus) || checkedThisRun.has(entryId)) continue;
        if (state.settled[entryId] === entry.paymentStatus) continue;
        await checkPayment(entryId, entry.paymentStatus);
      }
    } catch (error: any) {
      run.errors.push(String(error?.message || error).slice(0, 500));
    }

    if (run.errors.length === 0) state.lastSuccessAt = run.at;
    await STATE().set({ ...state, lastRun: run });
    console.log(JSON.stringify({ fluentFormsPoll: run }));
    return run;
  });
}

/** The poll with the server's real WordPress, PayPal and Google access; null while the Fluent Forms API isn't set up. */
export async function pollTicketPurchasesNow(trigger: string): Promise<TicketPollRun | null> {
  const fluentForms = fluentFormsApiFromEnv();
  if (!fluentForms) return null;
  return pollTicketPurchases({
    fluentForms,
    paypal: await paypalForTickets(),
    sheets: async () => {
      const client = await getSweeperAuthClient();
      return client ? google.sheets({ version: "v4", auth: client }) : null;
    },
  }, trigger);
}

/**
 * Setup New Auction Year: the new season starts after the newest entry, so
 * last year's purchases are never added to the cleared sheet. Without the
 * Fluent Forms API the state is just removed, and the next poll starts the
 * season itself.
 */
export async function startNewTicketSeason(): Promise<number | null> {
  const fluentForms = fluentFormsApiFromEnv();
  if (!fluentForms) {
    await STATE().delete();
    return null;
  }
  const latest = await fluentForms.latestEntryId();
  await STATE().set({ seasonStartEntryId: latest, highWaterEntryId: latest, settled: {} });
  return latest;
}
