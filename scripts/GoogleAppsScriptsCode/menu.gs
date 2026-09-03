const MENU_TITLE = 'Auction';
const PRE_AUCTION_TASKS = 'Pre-Auction Tasks';
const MID_AUCTION_TASKS = 'Auction Tasks';
const PRINTING_TASKS = 'Printing Tasks';

/** @OnlyCurrentDoc */
function onOpen ( e ) { createCustomMenu(); }
function onInstall ( e ) { createCustomMenu(); }

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