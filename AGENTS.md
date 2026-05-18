# Auction Management Rules

## Winner Notifications
- **Persistent Warnings**: Always use `duration: Infinity` and an `action` with the label "I have confirmed" for toast warnings triggered when a bidder who has already checked out wins a gift card, raffle, or high-value item.
- **Specific Messaging**: When a bidder wins an item after checking out, the notification must explicitly state the name of the item they won.

## Bundling Workflow
- **Item Restoration**: When restoring a bundle, the active bundle row must be deactivated (Status: "Inactive") and its sequential ID (Column A) cleared. The constituent items must be restored to "Active" status.
- **Re-sequencing**: Any operation that changes item status or category must trigger a re-sequencing of the affected categories to ensure gap-free Auction Item IDs.
