# Security Specification for orns-auction-bid-management

## Data Invariants
1. Global configuration (settings) can only be read and written by users with an `@orns.org` email domain.
2. Only verified emails are allowed to access settings.
3. Configuration document IDs must strictly follow the `isValidId` pattern (alphanumeric and some special characters, max 128 chars).

## The "Dirty Dozen" Payloads

1. **Unauthenticated Read**: Try to read `settings/main` without being signed in.
2. **Non-ORNS User Read**: Try to read `settings/main` with a personal `@gmail.com` account.
3. **Unverified Email Read**: Try to read `settings/main` with an `@orns.org` account that is not email-verified.
4. **Unauthenticated Write**: Try to write to `settings/main` without being signed in.
5. **Non-ORNS User Write**: Try to write to `settings/main` with a personal account.
6. **Unverified Email Write**: Try to write to `settings/main` with an unverified `@orns.org` account.
7. **Invalid ID Poisoning**: Try to create a document in `settings` with a 2KB string as ID.
8. **Missing Required Fields**: Try to write a config object missing `auctionItemsSpreadsheetId`.
9. **Invalid Type for Field**: Try to write a config object where `ticketPrice` is a boolean instead of a string.
10. **Extra Fields (Shadow Update)**: Try to write a config object with an extra field `isAdmin: true`.
11. **Malicious ID Characters**: Try to create a document in `settings` with ID `../tokens/admin`.
12. **Blanket Query**: Try to `list` the `settings` collection without any filters (should be restricted by `resource.data` logic).

## The Test Runner
A test suite will be implemented in `firestore.rules.test.ts` to verify these protections.
