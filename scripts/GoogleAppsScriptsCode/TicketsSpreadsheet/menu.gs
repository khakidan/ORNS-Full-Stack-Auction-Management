/**
 * The custom "Auction Documents" menu (manual bidder-label/settings
 * scripts) is deliberately disabled - the ORNS Auction Manager web app is
 * now the single source of use; this spreadsheet is data storage only.
 * `Class_SettingsManager.gs`, `Class_UIManager.gs`, and the menu-only
 * `generateBidderLabels()` wrapper it drove were deleted outright (not
 * just disconnected) once confirmed to have no other callers - see
 * CHANGELOG.md. Matches the same policy and sequencing already applied to
 * the Bid-Management and Items spreadsheets' menu.gs.
 */
/** @OnlyCurrentDoc */
function onOpen ( e ) {}
function onInstall ( e ) {}
