/**
 * The custom "Auction" menu (manual bundling/labels/document-generation
 * scripts) is deliberately disabled - the ORNS Auction Manager web app is
 * now the single source of use; this spreadsheet is data storage only.
 * `createCustomMenu()` and the manager classes/menu-only wrapper functions
 * it drove were deleted outright (not just disconnected) once confirmed to
 * have no other callers - see CHANGELOG.md. Matches the same policy and
 * sequencing already applied to the Bid-Management spreadsheet's menu.gs.
 */
/** @OnlyCurrentDoc */
function onOpen ( e ) {}
function onInstall ( e ) {}
