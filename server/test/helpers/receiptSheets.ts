import { http, HttpResponse } from "msw";
import { server } from "../setup";

/**
 * A stateful Bid-Management spreadsheet + Items spreadsheet for the
 * receipt/email tests: Sheets PUTs (J/K invoice writes, M/N "emailed"
 * records, the M1:N1 header) land in `bidderNumbers`, so later reads in
 * the same test see them - the way a re-run of a batch would.
 *
 * Gmail sends are captured and decoded into `sentEmails`; PayPal invoice
 * creations are counted (the default sandbox mocks from handlers.ts still
 * answer them).
 */
export interface SentEmail {
  to: string;
  headers: string;
  html: string;
}

export interface ReceiptSheetsMock {
  bidderNumbers: any[][];
  sentEmails: SentEmail[];
  invoicesCreated: () => number;
  /** Make any Sheets write whose A1 range (e.g. "'Bidder-Numbers'!M2:N2") ends with one of these fail with a (non-retried) 400. */
  failWritesTo: Set<string>;
  /** Make the Gmail send to these addresses fail with a (non-retried) 400. */
  failEmailsTo: Set<string>;
}

export function decodeRawEmail(raw: string): { headers: string; html: string } {
  const text = Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
  const split = text.indexOf("\r\n\r\n");
  return { headers: text.slice(0, split), html: text.slice(split + 4) };
}

export function mockReceiptSheets(opts: { bidderNumbers: any[][]; bidManagement: any[][]; auctionItems: any[][] }): ReceiptSheetsMock {
  // Pad every row to column N so M/N writes have somewhere to land.
  const bidderNumbers = opts.bidderNumbers.map((row) => {
    const padded = [...row];
    while (padded.length < 14) padded.push("");
    return padded;
  });
  const sentEmails: SentEmail[] = [];
  const failWritesTo = new Set<string>();
  const failEmailsTo = new Set<string>();
  let invoiceCount = 0;

  server.use(
    http.get("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", ({ params }) => {
      const range = decodeURIComponent(String(params.range));
      if (range.includes("Bid-Management")) return HttpResponse.json({ values: opts.bidManagement });
      if (range.includes("Bidder-Numbers")) return HttpResponse.json({ values: bidderNumbers });
      if (range.includes("Auction-Items")) return HttpResponse.json({ values: opts.auctionItems });
      return HttpResponse.json({ values: [] });
    }),
    http.put("https://sheets.googleapis.com/v4/spreadsheets/:spreadsheetId/values/:range", async ({ params, request }) => {
      const range = decodeURIComponent(String(params.range));
      if ([...failWritesTo].some((suffix) => range.endsWith(suffix))) {
        return HttpResponse.json({ error: { code: 400, message: "write rejected" } }, { status: 400 });
      }
      const match = range.match(/!([A-Z])(\d+):([A-Z])\d+$/);
      if (!match) return HttpResponse.json({ updatedRows: 1 });
      const row = Number(match[2]);
      const startCol = match[1].charCodeAt(0) - 65;
      const body: any = await request.clone().json();
      body.values[0].forEach((value: any, i: number) => { bidderNumbers[row - 1][startCol + i] = value; });
      return HttpResponse.json({ updatedRows: 1 });
    }),
    http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", async ({ request }) => {
      const body = (await request.json()) as { raw: string };
      const { headers, html } = decodeRawEmail(body.raw);
      const to = (headers.match(/^To: (.*)$/m) || [])[1] || "";
      if (failEmailsTo.has(to)) {
        return HttpResponse.json({ error: { code: 400, message: "Invalid To header" } }, { status: 400 });
      }
      sentEmails.push({ to, headers, html });
      return HttpResponse.json({ id: `msg-${sentEmails.length}`, labelIds: ["SENT"] });
    }),
    http.post("https://api-m.sandbox.paypal.com/v2/invoicing/invoices", () => {
      invoiceCount++;
      return HttpResponse.json({ id: `INV2-MOCK-0000-0000-000${invoiceCount}` }, { status: 201 });
    })
  );

  return { bidderNumbers, sentEmails, invoicesCreated: () => invoiceCount, failWritesTo, failEmailsTo };
}
