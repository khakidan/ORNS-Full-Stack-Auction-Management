/**
 * Data manager. Handles all pre-auction sheet setup tasks:
 *   - Ensuring the Auction-Items and Bid-Management sheets exist
 *   - Building the Bid-Management column headers and formatting
 *
 * Extracted from AuctionWorkflowManager. Extends GlobalStyles because
 * formatBiddingSheetColumns_ uses this.bandingColors.
 */
class AuctionSetupManager extends GlobalStyles {
    constructor () {
        super();
        this.uiManager = new UIManager();
        this.bidderManager = new BidderManager();
        this.auctionItemManager = new AuctionItemManager();
    }

    // ── Sheet existence guards ────────────────────────────────────────────────
    /**
     * Ensures the Auction-Items and Bid-Management sheets exist.
     * Called at the start of createBidMgmtSheet() so it only runs on demand,
     * not at construction time.
     */
    setupSheets_ () {
        this.auctionItemManager.ensureAuctionItemsSheet();

        if ( !this.activeSpreadSheet.getSheetByName( this.bidManagementString ) ) {
            this.activeSpreadSheet.insertSheet().setName( this.bidManagementString );
        }
    }

    // ── Sheet setup ───────────────────────────────────────────────────────────
    /**
     * Builds the column headers in the Bid-Management sheet, one pair of columns
     * per bidder, formatted with color banding and frozen rows.
     * Guards against overwriting an already-set-up sheet.
     */
    createBidMgmtSheet () {
        const s = this.uiManager.strings;
        this.setupSheets_();

        const bidSheet = this.activeSpreadSheet.getSheetByName( this.bidManagementString );

        if ( bidSheet.getRange( 'A1' ).getValue() !== '' ) {
            this.uiManager.showAlert( s.bidMgmtAlreadySetupTitle, s.bidMgmtAlreadySetupMsg );
            return;
        }

        const numBidders = this.bidderManager.bidders.loopLength;

        if ( numBidders <= 0 ) {
            this.uiManager.showAlert( s.setupErrorTitle, s.noBiddersFoundMsg );
            return;
        }

        const totalCols = numBidders * 2;
        const row1 = [], row2 = [], row3 = [];

        for ( let i = 0; i < numBidders; i++ ) {
            const bidder = this.bidderManager.bidders.range[ i ];
            row1.push( bidder[ 0 ], '' );
            row2.push( bidder[ 1 ], bidder[ 2 ] );
            row3.push( 'Item #:', 'Price:' );
        }

        const headerRange = bidSheet.getRange( 1, 1, 3, totalCols );
        headerRange.setValues( [ row1, row2, row3 ] ).setHorizontalAlignment( 'center' );
        bidSheet.getRange( 2, 1, 1, totalCols ).setFontWeight( 'bold' );

        for ( let i = 0; i < numBidders; i++ ) {
            bidSheet.getRange( 1, ( 2 * i ) + 1, 1, 2 ).mergeAcross();
        }

        bidSheet.setFrozenRows( 3 );

        this.auctionItemManager.removeExtraAuctionItemInfo_();
        this.auctionItemManager.addStandardAuctionItems_();
        this.clearExtraRows_( bidSheet );
        // this.formatBiddingSheetColumns_(bidSheet, numBidders);
    }

    /**
     * Applies alternating color banding to each bidder's two-column pair.
     * Cycles through this.bandingColors (10 colors) using modulo.
     * @param {GoogleAppsScript.Spreadsheet.Sheet} bidSheet
     * @param {number} numBidders
     */
    formatBiddingSheetColumns_ ( bidSheet, numBidders ) {
        for ( let i = 0; i < numBidders; i++ ) {
            const color = this.bandingColors[ i % this.bandingColors.length ];
            const colStart = ( 2 * i ) + 1;
            bidSheet.getRange( 1, colStart, bidSheet.getMaxRows(), 2 ) // ← getMaxRows(), not 5
                .applyRowBanding()
                .setFirstRowColor( color )
                .setSecondRowColor( '#ffffff' );
        }
    }

    /**
     * Trims the Bid-Management sheet to 25 rows to keep it tidy at setup time.
     * @param {GoogleAppsScript.Spreadsheet.Sheet} bidSheet
     */
    clearExtraRows_ ( bidSheet ) {
        const maxRows = bidSheet.getMaxRows();
        if ( maxRows > 23 ) bidSheet.deleteRows( 24, maxRows - 23 );
    }
}

function createBidMgmtSheet () { new AuctionSetupManager().createBidMgmtSheet(); }