import { ReactNode } from "react";

interface FormSectionProps {
  title: string;
  children: ReactNode;
}

/**
 * Generic section wrapper (uppercase label + grouped fields) shared by
 * every sectioned add/edit dialog in the app - originally built for the
 * Auction Item dialogs (AddAuctionItemDialog.tsx/EditAuctionItemDialog.tsx)
 * so those two forms read as one visual workflow despite collecting
 * different fields, then reused for the Attendee dialogs
 * (AddAttendeeDialog.tsx/EditAttendeeDialog.tsx) for the same reason - see
 * the "Attendee Tickets workflow challenges" bug report.
 */
export function FormSection({ title, children }: FormSectionProps) {
  return (
    <div>
      <div className="text-xxs font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">{title}</div>
      {children}
    </div>
  );
}
