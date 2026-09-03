/**
 * The custom "Auction" menu (manual Check-In/Check-Out/Bid Entry/Settings/
 * Printing dialogs) is deliberately disabled - the ORNS Auction Manager
 * web app is now the single source of use for running an auction; this
 * spreadsheet is data storage only. `createCustomMenu()` and the manager
 * classes it drove were deleted outright (not just disconnected) once
 * confirmed to have no other callers - see CHANGELOG.md.
 */
/** @OnlyCurrentDoc */
function onOpen ( e ) {}
function onInstall ( e ) {}
