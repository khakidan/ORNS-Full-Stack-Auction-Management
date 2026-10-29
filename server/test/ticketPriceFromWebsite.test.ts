/**
 * The ticket price, taken from the website's ticket form at Set Up Bid
 * Management App: each of this season's entries' total over its tickets.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "./setup";
import { describeWebsiteTicketPrice, pricesPerTicket, readWebsiteTicketPrice, syncTicketPriceFromWebsite } from "../services/ticketPriceFromWebsite";
import { FluentFormsEntry } from "../services/fluentFormsApi";
import { getAdminFirestore } from "../services/firebaseAdmin";
import { _resetConfigCacheForTesting } from "../services/configService";

const entry = (id: number, tickets: string, total: number, overrides: Partial<FluentFormsEntry> = {}): FluentFormsEntry => ({
  id, formId: "7", status: "unread", paymentMethod: "paypal", paymentStatus: "paid", total, createdAt: "2027-02-01 10:00:00",
  response: { names: { first_name: "Pat", last_name: "Lee" }, payment_input: tickets },
  ...overrides,
});

describe("pricesPerTicket", () => {
  it("divides each entry's total by its tickets - the form's choices are 1 to 4 tickets, each with its own total", () => {
    expect(pricesPerTicket([entry(1, "1", 35), entry(2, "2", 70), entry(3, "4", 140), entry(4, "3", 100)])).toEqual(["35", "35", "35", "33.33"]);
  });

  it("skips spam, entries without a total, and entries whose tickets can't be read", () => {
    expect(pricesPerTicket([entry(1, "2", 70, { status: "spam" }), entry(2, "2", 0), entry(3, "", 70), entry(4, "two", 70)])).toEqual([]);
  });
});

describe("readWebsiteTicketPrice", () => {
  const wordpress = (entries: FluentFormsEntry[]) => ({ listEntriesAfter: vi.fn(async (after: number) => entries.filter((e) => e.id > after)) });

  it("reads only this season's entries, and answers the price they agree on", async () => {
    const fluentForms = wordpress([entry(1400, "2", 60), entry(1483, "2", 70), entry(1484, "1", 35)]);
    expect(await readWebsiteTicketPrice(fluentForms, 1482)).toEqual({ price: "35" });
    expect(fluentForms.listEntriesAfter).toHaveBeenCalledWith(1482);
  });

  it("names the prices when entries disagree (a coupon, or a price changed mid-season)", async () => {
    expect(await readWebsiteTicketPrice(wordpress([entry(1483, "2", 70), entry(1484, "2", 60), entry(1485, "1", 35)]), 1482)).toEqual({ outcome: "disagree", prices: ["30", "35"] });
  });

  it("says so when nobody has bought a ticket yet this season", async () => {
    expect(await readWebsiteTicketPrice(wordpress([entry(1400, "2", 70)]), 1482)).toEqual({ outcome: "no-purchases" });
  });
});

describe("syncTicketPriceFromWebsite (Set Up Bid Management App)", () => {
  const ENV = ["FLUENT_FORMS_SITE_URL", "FLUENT_FORMS_API_USER", "FLUENT_FORMS_API_PASSWORD"] as const;
  const saved = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
  const config = () => getAdminFirestore().collection("settings").doc("global");
  const NOW = new Date("2027-03-01T15:00:00Z");

  /** WordPress's entries list, newest first, as Fluent Forms sends it. */
  const website = (entries: FluentFormsEntry[]) => server.use(http.get("https://www.example.org/wp-json/fluentform/v1/submissions", () => HttpResponse.json({
    last_page: 1,
    data: [...entries].sort((a, b) => b.id - a.id).map((e) => ({ id: e.id, form_id: e.formId, status: e.status, payment_method: e.paymentMethod, payment_status: e.paymentStatus, payment_total: e.total * 100, created_at: e.createdAt, response: JSON.stringify(e.response) })),
  })));

  beforeEach(async () => {
    Object.assign(process.env, { FLUENT_FORMS_SITE_URL: "https://www.example.org", FLUENT_FORMS_API_USER: "u", FLUENT_FORMS_API_PASSWORD: "p" });
    _resetConfigCacheForTesting();
    await config().set({ ticketPrice: "30", receiptFolderId: "receipts" });
    await getAdminFirestore().collection("system").doc("fluentFormsPoll").set({ seasonStartEntryId: 1482, highWaterEntryId: 1490, settled: {} });
  });
  afterEach(() => {
    for (const key of ENV) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  });

  it("sets Settings' price to the website's, marks where it came from, and keeps the rest of the Config", async () => {
    website([entry(1483, "2", 70), entry(1484, "4", 140)]);

    const result = await syncTicketPriceFromWebsite("jane@orns.org", NOW);

    expect(result).toEqual({ outcome: "updated", price: "35", previous: "30" });
    expect((await config().get()).data()).toMatchObject({ ticketPrice: "35", ticketPriceFromWebsiteAt: NOW.toISOString(), receiptFolderId: "receipts", updatedBy: "jane@orns.org" });
    expect(describeWebsiteTicketPrice(result)).toBe("Ticket price changed from $30 to $35 to match the website.");
  });

  it("answers unchanged when Settings already matches, still marking it as from the website", async () => {
    await config().set({ ticketPrice: "35.00" });
    website([entry(1483, "2", 70)]);

    expect(await syncTicketPriceFromWebsite("jane@orns.org", NOW)).toEqual({ outcome: "unchanged", price: "35" });
    expect((await config().get()).data()).toMatchObject({ ticketPrice: "35", ticketPriceFromWebsiteAt: NOW.toISOString() });
  });

  it.each([
    ["entries disagree", [entry(1483, "2", 70), entry(1484, "2", 60)], "disagree"],
    ["nobody has bought yet", [], "no-purchases"],
  ])("leaves Settings alone when %s", async (_label, entries, outcome) => {
    website(entries);

    expect((await syncTicketPriceFromWebsite("jane@orns.org", NOW)).outcome).toBe(outcome);
    expect((await config().get()).data()).toEqual({ ticketPrice: "30", receiptFolderId: "receipts" });
  });

  it("never throws - an unreachable website leaves Settings alone and says why", async () => {
    server.use(http.get("https://www.example.org/wp-json/fluentform/v1/submissions", () => HttpResponse.json({ code: "rest_forbidden" }, { status: 403 })));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await syncTicketPriceFromWebsite("jane@orns.org", NOW);

    expect(result).toEqual({ outcome: "unavailable", reason: "the website couldn't be read" });
    expect(describeWebsiteTicketPrice(result)).toContain("left as it is");
    expect((await config().get()).data()?.ticketPrice).toBe("30");
    warn.mockRestore();
  });

  it("does nothing without the Fluent Forms API, or before the ticket check has started a season", async () => {
    await getAdminFirestore().collection("system").doc("fluentFormsPoll").delete();
    expect(await syncTicketPriceFromWebsite("jane@orns.org", NOW)).toMatchObject({ outcome: "unavailable", reason: expect.stringContaining("hasn't started") });

    delete process.env.FLUENT_FORMS_API_PASSWORD;
    expect(await syncTicketPriceFromWebsite("jane@orns.org", NOW)).toMatchObject({ outcome: "unavailable", reason: expect.stringContaining("isn't set up") });
  });
});
