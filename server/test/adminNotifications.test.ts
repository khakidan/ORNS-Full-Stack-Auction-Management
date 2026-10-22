/**
 * notifyAdminOfBugReport: the "New Auction Bug Submitted" email to
 * web-admin@orns.org. Gmail is mocked by MSW; the stored background
 * sign-in (Firestore) is mocked, so nothing here reaches Google.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { http, HttpResponse, delay } from "msw";
import { server } from "./setup";
import type { BugReportPayload } from "../../src/types";

vi.mock("../services/paypalSweeperJob", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/paypalSweeperJob")>()),
  getSweeperAuthClient: vi.fn(),
}));
import { getSweeperAuthClient } from "../services/paypalSweeperJob";
import { getAuthenticatedClient } from "../services/oauth";
import {
  BUG_REPORT_NOTIFY_SUBJECT, BUG_REPORT_NOTIFY_TO, _resetAdminNotificationsForTesting,
  buildBugReportNotificationHtml, notifyAdminOfBugReport,
} from "../services/adminNotifications";

const report: BugReportPayload = {
  title: "Checkout button does nothing",
  description: "Clicked twice, no response.",
  type: "Bug",
  timestamp: "2026-10-22T14:32:07.142Z",
  route: "/BidManagement (workflow: bids, tab: checkout)",
  appState: "Bidders: 42",
  browserInfo: "ua",
  consoleActivity: [],
  screenshotBase64: null,
};
const session = { access_token: "session-token", refresh_token: "session-refresh", expiry_date: Date.now() + 3600000 };
const backgroundClient = () => getAuthenticatedClient({ access_token: "background-token", expiry_date: Date.now() + 3600000 });

interface Sent { auth: string | null; raw: string }
/** Records each Gmail send; `fail` makes sends with a matching token answer 500. */
function captureGmail(opts: { failFor?: string; hangMs?: number } = {}) {
  const sent: Sent[] = [];
  server.use(
    http.post("https://gmail.googleapis.com/gmail/v1/users/:userId/messages/send", async ({ request }) => {
      const auth = request.headers.get("authorization");
      if (opts.hangMs) await delay(opts.hangMs);
      if (opts.failFor && auth?.includes(opts.failFor)) return HttpResponse.json({ error: { message: "backend error" } }, { status: 500 });
      const body: any = await request.json();
      sent.push({ auth, raw: body.raw });
      return HttpResponse.json({ id: "m1" });
    })
  );
  return sent;
}
const decode = (raw: string) => Buffer.from(raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");

describe("notifyAdminOfBugReport", () => {
  beforeEach(() => {
    _resetAdminNotificationsForTesting();
    vi.mocked(getSweeperAuthClient).mockResolvedValue(null);
  });

  it(`emails ${BUG_REPORT_NOTIFY_TO} with the subject "${BUG_REPORT_NOTIFY_SUBJECT}"`, async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
    const sent = captureGmail();

    expect(await notifyAdminOfBugReport(report, null)).toBe("sent");

    expect(sent).toHaveLength(1);
    const message = decode(sent[0].raw);
    expect(message).toContain("To: web-admin@orns.org");
    expect(message).toContain("Subject: New Auction Bug Submitted");
    expect(message).toContain("Checkout button does nothing");
    expect(message).toContain("Someone who was not signed in");
  });

  it("sends an anonymous report as the stored background sign-in, not as a session", async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
    const sent = captureGmail();

    await notifyAdminOfBugReport(report, null);

    expect(sent[0].auth).toContain("background-token");
  });

  it("falls back to the submitter's own session when no background sign-in is stored", async () => {
    const sent = captureGmail();

    expect(await notifyAdminOfBugReport(report, session)).toBe("sent");

    expect(sent[0].auth).toContain("session-token");
    expect(decode(sent[0].raw)).toContain("A signed-in staff member");
  });

  it("falls back to the session when the background sign-in is refused", async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
    const sent = captureGmail({ failFor: "background-token" });

    expect(await notifyAdminOfBugReport(report, session)).toBe("sent");

    expect(sent).toHaveLength(1);
    expect(sent[0].auth).toContain("session-token");
  });

  it("sends nothing and says why when there is no sign-in at all", async () => {
    const sent = captureGmail();

    expect(await notifyAdminOfBugReport(report, null)).toBe("no-credential");

    expect(sent).toHaveLength(0);
  });

  it("returns 'failed' without throwing when every sign-in is refused", async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
    captureGmail({ failFor: "token" });

    await expect(notifyAdminOfBugReport(report, session)).resolves.toBe("failed");
  });

  it("gives up when Gmail doesn't answer in time instead of holding up the report", async () => {
    vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
    captureGmail({ hangMs: 600 });

    expect(await notifyAdminOfBugReport(report, null, Date.now(), 50)).toBe("failed");
  });

  describe("limit", () => {
    it("sends at most 10 emails per 10 minutes, then says how many it skipped in the next one", async () => {
      vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
      const sent = captureGmail();
      const t0 = Date.parse("2026-10-22T12:00:00Z");

      for (let i = 0; i < 10; i++) expect(await notifyAdminOfBugReport(report, null, t0 + i)).toBe("sent");
      expect(await notifyAdminOfBugReport(report, null, t0 + 20)).toBe("throttled");
      expect(await notifyAdminOfBugReport(report, null, t0 + 30)).toBe("throttled");
      expect(sent).toHaveLength(10);
      expect(decode(sent[9].raw)).not.toContain("not emailed");

      // The window has passed: the next report is emailed and mentions the 2 skipped.
      expect(await notifyAdminOfBugReport(report, null, t0 + 11 * 60 * 1000)).toBe("sent");
      expect(sent).toHaveLength(11);
      expect(decode(sent[10].raw)).toContain("2 other reports");

      // ...and only that one email carries the note.
      expect(await notifyAdminOfBugReport(report, null, t0 + 11 * 60 * 1000 + 1)).toBe("sent");
      expect(decode(sent[11].raw)).not.toContain("not emailed");
    });

    it("doesn't count a failed send against the limit", async () => {
      vi.mocked(getSweeperAuthClient).mockResolvedValue(backgroundClient());
      captureGmail({ failFor: "background-token" });
      for (let i = 0; i < 12; i++) expect(await notifyAdminOfBugReport(report, null)).toBe("failed");

      const sent = captureGmail();
      expect(await notifyAdminOfBugReport(report, null)).toBe("sent");
      expect(sent).toHaveLength(1);
    });
  });
});

describe("buildBugReportNotificationHtml", () => {
  it("escapes everything the submitter typed - anyone can submit a report", () => {
    const html = buildBugReportNotificationHtml(
      { ...report, title: `<script>alert("x")</script>`, description: `<img src=x onerror=alert(1)> & more`, route: `"><b>` },
      false, 0, "https://orns-auction-manager.cloud.run"
    );

    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt; &amp; more");
    expect(html).toContain("&quot;&gt;&lt;b&gt;");
  });

  it("shortens a very long description", () => {
    const html = buildBugReportNotificationHtml({ ...report, description: "x".repeat(5000) }, true, 0, "https://example.org");

    expect(html).toContain("(shortened");
    expect(html.length).toBeLessThan(4000);
  });

  it("links to the app", () => {
    expect(buildBugReportNotificationHtml(report, true, 0, "https://orns-auction-manager.cloud.run")).toContain('href="https://orns-auction-manager.cloud.run"');
  });
});
