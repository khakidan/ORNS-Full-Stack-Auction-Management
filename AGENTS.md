# Auction Management Rules

## Winner Notifications
- **Persistent Warnings**: Always use `duration: Infinity` and an `action` with the label "I have confirmed" for toast warnings triggered when a bidder who has already checked out wins a gift card, raffle, or high-value item.
- **Specific Messaging**: When a bidder wins an item after checking out, the notification must explicitly state the name of the item they won.

## Bundling Workflow
- **Item Restoration**: When restoring a bundle, the active bundle row must be deactivated (Status: "Inactive") and its sequential ID (Column A) cleared. The constituent items must be restored to "Active" status.
- **Re-sequencing**: Any operation that changes item status or category must trigger a re-sequencing of the affected categories to ensure gap-free Auction Item IDs.

## Charity Auction Workflows & PayPal Integration
- **Tracking Columns**: The 'Bidder-Numbers' sheet contains automated tracking data fields in Column J (`Invoice URL`, public PayPal checkout) and Column K (`Invoice Total Amount`, numerical balance with fees).
- **apiSendAllEmails**: Call this execution loop once all winning entries are processed. It internally evaluates rows, constructs unique invoices, logs them to Columns J/K, and dispatches custom checkout URLs.
- **apiCreateAllReceipts**: Safe to run before or after emailing. It dynamically uses the cached 'Invoice URL' in Column J, or generates a new one to embed accurate QR codes within documents.
- **apiCreateIndividualReceipt / apiSendReceiptEmail**: Target specific IDs, leverage the same caching logic, and auto-update tracking metrics. MUST pass strict primitive string or numerical items (e.g., `apiCreateIndividualReceipt(String(bidderId), emailReceipt)`).
- **Surcharges**: NEVER manually calculate surcharge processing totals within the client application; `PayPalService.calculatePayPalSurcharge` natively executes this in the backend workspace.