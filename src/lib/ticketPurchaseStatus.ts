import { Attendee, TicketPurchaseStatus } from "@/types";

/** The poll runs 4 times a day; over this long since it last succeeded means two or more runs were missed. */
export const POLL_STALE_HOURS = 12;
/** A ticket still Pending this long after it was bought is worth a look. */
export const PENDING_DAYS = 7;

const HOUR_MS = 60 * 60 * 1000;

/** What on the status card needs staff, as short sentences; empty when all is well. */
export function ticketStatusProblems(status: TicketPurchaseStatus, now: Date): string[] {
  // W7 doesn't need the Fluent Forms API: the webhook alone finds these.
  const late = status.afterGoLive.length;
  const lateProblem = late > 0 ? [`${late} purchase(s) arrived after Go Live - register them as walk-ins.`] : [];
  if (!status.configured) return lateProblem;
  const problems: string[] = [...lateProblem];
  const lastSuccess = status.poll?.lastSuccessAt ? new Date(status.poll.lastSuccessAt).getTime() : null;
  if (lastSuccess === null) problems.push("The website check hasn't succeeded yet.");
  else if (now.getTime() - lastSuccess > POLL_STALE_HOURS * HOUR_MS) problems.push(`The website check hasn't succeeded in over ${POLL_STALE_HOURS} hours.`);
  if (status.poll && status.poll.lastRunErrors.length > 0) problems.push("The last website check stopped with an error.");
  if (status.lastWebhook?.outcome === "error" || status.lastWebhook?.outcome === "no-google-sign-in") problems.push("The last purchase sent by the website failed.");
  if (status.review.length > 0) problems.push(`${status.review.length} purchase(s) need review.`);
  return problems;
}

/** WordPress's local "2027-02-01 10:00:00" as a Date, or null. */
function submittedDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value.replace(" ", "T"));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Website purchases still Pending over PENDING_DAYS after they were bought, oldest first. */
export function pendingTooLong(attendees: Attendee[], submittedAt: Record<string, string>, now: Date): { attendee: Attendee; submitted: Date }[] {
  return attendees
    .map((attendee) => ({ attendee, submitted: submittedDate(attendee.formEntryId ? submittedAt[attendee.formEntryId] : undefined) }))
    .filter((row): row is { attendee: Attendee; submitted: Date } =>
      row.submitted !== null
      && row.attendee.paymentStatus.trim().toLowerCase() === "pending"
      && now.getTime() - row.submitted.getTime() > PENDING_DAYS * 24 * HOUR_MS)
    .sort((a, b) => a.submitted.getTime() - b.submitted.getTime());
}
