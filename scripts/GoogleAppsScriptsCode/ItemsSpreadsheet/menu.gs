const MENU_TITLE = 'Auction';
const BUNDLE_SCRIPTS_TITLE = 'Bundling Meeting Scripts';
const PACKAGING_SCRIPTS_TITLE = 'Packaging Meeting Scripts';
const READY_TO_PRINT_TITLE = 'Get Ready To Print Scripts';
const MISC_SCRIPTS_TITLE = 'Miscellaneous Scripts';
const PRINTED_DOC_MENU_TITLE = 'Create Printed Docs & Slideshow Scripts';
const BIDDING_GUIDE_MENU_TITLE = 'Bidding Guide (2 pages / 8 x 11.5 page size)';

/**
 * @OnlyCurrentDoc
 * Limits the scope of file access to the current document.
 */

function onOpen ( e ) { createCustomMenu(); }

function createCustomMenu () {
    const ui = SpreadsheetApp.getUi();

    ui.createMenu( MENU_TITLE )
        .addSubMenu( ui.createMenu( BUNDLE_SCRIPTS_TITLE )
            .addItem( 'Print All Auction Items for Bundling Meeting', 'printAuctionItemsForBundling' )
            .addItem( 'Bundle Auction Items', 'requestSequentialBundles' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( PACKAGING_SCRIPTS_TITLE )
            .addItem( 'Print Auction Item Labels', 'printLabelsForAuctionItems' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( READY_TO_PRINT_TITLE )
            .addItem( 'Setup Auction Item IDs', 'setAuctionIDsOnImportSheet' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( PRINTED_DOC_MENU_TITLE )
            .addSubMenu( ui.createMenu( BIDDING_GUIDE_MENU_TITLE )
                .addItem( 'Create Bidding Guide Cover Page', 'createNewBiddingGuideCoverPage' )
                .addItem( 'Create Bidding Guide Inside Pages', 'createNewBiddingGuideInnerPages' )
            )
            .addSeparator()
            .addItem( 'Create Bid Sheets (A5 page size)', 'createBidSheets' )
            .addItem( 'Create Auction Catalog (8 x 11.5 page size)', 'createNewCatalog' )
            .addItem( 'Create Table Tents (8 x 11.5 page size)', 'createTableTents' )
            .addItem( 'Create Live Auction Presentation', 'createNewPresentation' )
        )
        .addSeparator()
        .addSubMenu( ui.createMenu( MISC_SCRIPTS_TITLE )
            .addItem( 'Set File & Folder Locations', 'updateFileOrFolderLocations' )
            .addItem( 'Create Category Tab Sheet', 'fixEmptyCategorySheet' )
        )
        .addToUi();
}