/**
 * Data manager. Handles live bid data entry and reporting:
 *   - Recording winning bids into the Bid-Management sheet
 *   - Validating that a bidder is checked in or is a proxy before accepting a bid
 *   - Looking up bidder columns and rows
 *   - Calculating and displaying the grand total raised
 *
 * Extracted from AuctionWorkflowManager. Extends GlobalVariables (not
 * GlobalStyles) — no spreadsheet column formatting or document styles needed.
 */
class BidEntryManager extends GlobalVariables {
    constructor () {
        super();
        this.uiManager = new UIManager();
        this.bidderManager = new BidderManager();
        // NEW: Instantiate AuctionItemManager to validate item IDs
        this.auctionItemManager = new AuctionItemManager();
    }

    // ── Bid-Management sheet accessor ─────────────────────────────────────────
    /**
     * Lazy-loads and caches the full Bid-Management sheet data range,
     * including the header rows (rows 1–3).
     */
    get bidManagement () {
        if ( this._bidManagement ) return this._bidManagement;

        const sheet = this.activeSpreadSheet.getSheetByName( this.bidManagementString );
        if ( !sheet ) return { sheet: null, lastRow: 0, lastCol: 0, range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 0
            ? sheet.getRange( 1, 1, lastRow, lastCol ).getValues()
            : [];

        this._bidManagement = {
            sheet, lastRow, lastCol,
            range: dataRange,
            loopLength: Math.max( 0, lastRow - 1 )
        };
        return this._bidManagement;
    }

    // ── Lookup helpers ────────────────────────────────────────────────────────
    /**
     * Returns the 1-based column index for a bidder ID in the Bid-Management
     * header row. Returns -1 if not found.
     * NOTE: Returns a 1-based index for direct use with sheet.getRange().
     * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
     * @param {string|number} bidId
     * @returns {number}
     */
    findBidderColumn_ ( sheet, bidId ) {
        const header = sheet.getRange( 1, 1, 1, sheet.getLastColumn() ).getValues()[ 0 ];
        for ( let j = 0; j < header.length; j += 2 ) {
            if ( header[ j ].toString() === bidId.toString() ) return j + 1;
        }
        return -1;
    }

    /**
     * Looks up a bidder's full data row from the Bidder-Numbers sheet by ID.
     * Returns the row array (0-based) or null if not found.
     *
     * Column map for the returned row:
     *   [0] ID  [1] First  [2] Last  [3] Email
     *   [4] Checked In  [5] Proxy Bidder  [6] Checked Out  [7] Paid
     *
     * @param {string|number} bidId
     * @returns {Array|null}
     */
    findBidderRowById_ ( bidId ) {
        const data = this.bidderManager.bidders.sheet.getDataRange().getValues();
        for ( let i = 1; i < data.length; i++ ) {
            if ( data[ i ][ 0 ].toString() === bidId.toString() ) return data[ i ];
        }
        return null;
    }

    // ── Bid data entry ────────────────────────────────────────────────────────
    /**
     * Continuously records winning bids until the user cancels.
     * Before writing, verifies that the bidder is either checked in or flagged
     * as a proxy bidder. Expands the sheet automatically if it runs out of rows.
     */
    runWinningBidDataEntry () {
        const s = this.uiManager.strings;
        const bidMgmtSheet = this.bidManagement.sheet;
        const bidMgmtHeader = bidMgmtSheet.getRange( 1, 1, 1, bidMgmtSheet.getLastColumn() ).getValues()[ 0 ];
        const bidderNumbersData = this.bidderManager.bidders.sheet.getDataRange().getValues();
        let active = true;

        while ( active ) {

            // ── Item ID prompt ────────────────────────────────────────────────
            let cleanedItemId = '';
            while ( true ) {
                const itemText = this.uiManager.promptOkCancel( s.dataEntryTitle, s.itemNumberPrompt );
                if ( itemText === null ) { active = false; break; }

                cleanedItemId = itemText.trim();
                if ( cleanedItemId === '' ) {
                    this.uiManager.showAlert( s.invalidInputTitle, s.blankItemMsg );
                    continue;
                }

                const itemName = this.auctionItemManager.getItemName( cleanedItemId );
                if ( itemName === 'Unknown Item' ) {
                    this.uiManager.showAlert( s.itemNotFoundTitle, s.itemNotFoundMsg( cleanedItemId ) );
                    continue;
                }
                break;
            }
            if ( !active ) break;

            // ── Bidder ID prompt ──────────────────────────────────────────────
            let col = -1;
            let bidId = '';
            while ( true ) {
                const bidderText = this.uiManager.promptOkCancel( s.dataEntryTitle, s.bidderIdPrompt );
                if ( bidderText === null ) { active = false; break; }

                bidId = bidderText.trim();
                if ( bidId === '' ) {
                    this.uiManager.showAlert( s.invalidInputTitle, s.blankBidderIdMsg );
                    continue;
                }

                col = -1;
                for ( let j = 0; j < bidMgmtHeader.length; j += 2 ) {
                    if ( bidMgmtHeader[ j ].toString() === bidId ) { col = j + 1; break; }
                }

                if ( col === -1 ) {
                    this.uiManager.showAlert( s.bidderNotFoundTitle, s.bidderNotFoundInBidMgmtMsg( bidId ) );
                    continue;
                }

                let bidderRow = null;
                for ( let i = 1; i < bidderNumbersData.length; i++ ) {
                    if ( bidderNumbersData[ i ][ 0 ].toString() === bidId ) { bidderRow = bidderNumbersData[ i ]; break; }
                }

                const isCheckedIn = bidderRow && bidderRow[ 4 ] === true;
                const isProxyBidder = bidderRow && bidderRow[ 5 ] === true;

                if ( !isCheckedIn && !isProxyBidder ) {
                    this.uiManager.showAlert( s.bidderNotCheckedInTitle, s.bidderNotCheckedInMsg( bidId ) );
                    continue;
                }
                break;
            }
            if ( !active ) break;

            // ── Price prompt ──────────────────────────────────────────────────
            let cleanedPrice = '';
            while ( true ) {
                const priceText = this.uiManager.promptOkCancel( s.dataEntryTitle, s.winningBidPrompt );
                if ( priceText === null ) { active = false; break; }

                cleanedPrice = priceText.replace( /[^0-9.]/g, '' );
                if ( cleanedPrice === '' || isNaN( parseFloat( cleanedPrice ) ) ) {
                    this.uiManager.showAlert( s.invalidPriceTitle, s.invalidBidPriceMsg );
                    continue;
                }
                break;
            }
            if ( !active ) break;

            // ── Write the bid ─────────────────────────────────────────────────
            const maxRow = bidMgmtSheet.getMaxRows();
            const colData = bidMgmtSheet.getRange( 4, col, maxRow - 3, 1 ).getValues();

            let row = 4;
            for ( let i = 0; i < colData.length; i++ ) {
                if ( colData[ i ][ 0 ] === '' ) break;
                row++;
            }

            if ( row > maxRow ) {
                bidMgmtSheet.insertRowsAfter( maxRow, 10 );
                this.uiManager.showLoadingToast(
                    '10 extra rows were automatically added to the Bid-Management sheet.',
                    'Sheet Expanded', 5
                );
            }

            bidMgmtSheet.getRange( row, col, 1, 2 ).setValues( [ [ cleanedItemId, cleanedPrice ] ] );

            active = this.uiManager.confirmYesNo( s.continueTitle, s.enterAnotherBidMsg );
        }
    }

    // ── Reporting ─────────────────────────────────────────────────────────────
    /**
     * Sums all winning bid prices in the Bid-Management sheet (every even-indexed
     * column, starting from column 2 of each bidder pair) and displays the total.
     */
    calculateTotalRaised () {
        const s = this.uiManager.strings;
        const bidMgmtSheet = this.bidManagement.sheet;

        if ( !bidMgmtSheet ) {
            this.uiManager.showAlert( s.systemErrorTitle, s.bidMgmtNotFoundMsg );
            return;
        }

        const data = bidMgmtSheet.getDataRange().getValues();
        const lastCol = bidMgmtSheet.getLastColumn();
        let grandTotal = 0;

        for ( let col = 1; col < lastCol; col += 2 ) {
            for ( let row = 3; row < data.length; row++ ) {
                if ( data[ row ] && data[ row ][ col ] !== '' ) {
                    const priceNum = parseFloat( data[ row ][ col ].toString().replace( /[^0-9.]/g, '' ) );
                    if ( !isNaN( priceNum ) ) grandTotal += priceNum;
                }
            }
        }

        const formatted = grandTotal.toLocaleString( 'en-US', { style: 'currency', currency: 'USD' } );
        this.uiManager.showAlert( s.auctionTotalTitle, s.totalRaisedMsg( formatted ) );
    }
}

function runWinningBidDataEntry () { new BidEntryManager().runWinningBidDataEntry(); }
function calculateTotalRaised () { new BidEntryManager().calculateTotalRaised(); }