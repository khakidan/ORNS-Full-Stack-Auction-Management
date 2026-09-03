const MENU_TITLE = 'Auction';
const PRE_AUCTION_TASKS = 'Pre-Auction Tasks';
const MID_AUCTION_TASKS = 'Auction Tasks';
const PRINTING_TASKS = 'Printing Tasks';

/**
 * The custom "Auction" menu (manual Check-In/Check-Out/Bid Entry/Settings/
 * Printing dialogs) is deliberately disabled - the ORNS Auction Manager
 * web app is now the single source of use for running an auction; this
 * spreadsheet is data storage only. `createCustomMenu()` itself is left
 * defined below (unused) rather than deleted, in case it's ever needed
 * again as a manual fallback.
 */
/** @OnlyCurrentDoc */
function onOpen ( e ) {}
function onInstall ( e ) {}

function createCustomMenu () {
    const ui = SpreadsheetApp.getUi();

    ui.createMenu( MENU_TITLE )
        .addSubMenu( ui.createMenu( PRE_AUCTION_TASKS )
            .addItem( 'Update Ticket Price', 'updateTicketPriceWorkflow' )
            .addItem( 'Set File & Folder Locations', 'updateFileOrFolderLocations' )
            .addItem( 'Setup Bidder Numbers', 'setupBiddersSheet' )
            .addItem( 'Setup Bid Management', 'createBidMgmtSheet' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( MID_AUCTION_TASKS )
            .addItem( 'Run Bidder Check-In', 'startCheckInProcess' )
            .addItem( 'Enter Winning Bids', 'runWinningBidDataEntry' )
            .addItem( 'Run Bidder Check-Out', 'startCheckOutProcess' )
            .addItem( 'Calculate Total Raised', 'calculateTotalRaised' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( PRINTING_TASKS )
            .addItem( 'Create An Individual Receipt', 'createIndividualReceipt' )
            .addItem( 'Create Receipts For All Bidders With Winning Bids', 'createAllReceipts' )
            .addItem( 'Test An Individual Receipt', 'testCreateIndividualReceipt' )
            .addItem( 'Test Receipts For All Bidders With Winning Bids', 'testCreateAllReceipts' )
        )
        .addToUi();
}