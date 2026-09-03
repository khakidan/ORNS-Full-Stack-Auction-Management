/**
 * Data manager. Extends GlobalVariables for spreadsheet and config access.
 *
 * Responsibilities:
 *   - Lazy-load and own the Bidder-Numbers sheet data
 *   - Load bidder rows from the external ticket spreadsheet
 *   - Orchestrate the full bidder-sheet setup workflow
 */
class BidderManager extends GlobalVariables {
    constructor () {
        super();
        this.uiManager = new UIManager();

        // Column header string constants
        this.idString = 'ID';
        this.firstNameString = 'First Name';
        this.lastNameString = 'Last Name';
        this.emailString = 'Email';
        this.checkedInString = 'Checked In';
        this.proxyBidderString = 'Proxy Bidder';
        this.checkedOutString = 'Checked Out';
        this.paidString = 'Paid';
        this.paymentMethod = 'Payment Method';
        this.invoiceURL = 'Invoice URL';
        this.invoicedAmount = 'Invoiced Amount';

        // Ticket sheet name constants
        this.auctionTicketsString = 'tickets';
        this.auctionStaffTicketsString = 'staff tickets';
        this.auctionSponsorTicketsString = 'sponsor tickets';
    }

    // ── Sheet data getter ────────────────────────────────────────────────────
    /** Lazy-loads and caches the Bidder-Numbers sheet data. */
    get bidders () {
        if ( this._bidders ) return this._bidders;
        const sheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        if ( !sheet ) return { sheet: null, lastRow: 0, lastCol: 0, range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 1
            ? sheet.getRange( 2, 1, lastRow - 1, lastCol ).getValues()
            : [];

        this._bidders = { sheet, lastRow, lastCol, range: dataRange, loopLength: Math.max( 0, lastRow - 1 ) };
        return this._bidders;
    }

    /** Full data range including header row (needed for email column lookup). */
    get biddersFullData () {
        if ( !this._biddersFullData ) {
            const sheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
            this._biddersFullData = sheet ? sheet.getDataRange().getValues() : [];
        }
        return this._biddersFullData;
    }

    // ── Ticket-package loader ────────────────────────────────────────────────
    /**
     * Safely reads a named sheet from the external tickets spreadsheet.
     * @param {string} sheetName
     * @returns {{ range: Array[][], loopLength: number }}
     */
    _getTicketPackage ( sheetName ) {
        const ticketSpreadsheet = this.getAuctionTicketsSheet_();
        if ( !ticketSpreadsheet ) return { range: [], loopLength: 0 };

        const sheet = ticketSpreadsheet.getSheetByName( sheetName );
        if ( !sheet ) return { range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 1
            ? sheet.getRange( 2, 1, lastRow - 1, lastCol ).getValues()
            : [];

        return { range: dataRange, loopLength: Math.max( 0, lastRow - 1 ) };
    }

    /** Lazy-loads the external tickets spreadsheet via DriveService-style safeFetch. */
    getAuctionTicketsSheet_ () {
        if ( !this._ticketsSpreadsheet ) {
            const id = this.config[ 'auctionTicketSheetsID' ];
            if ( !id || id.toString().includes( 'PASTE' ) ) return null;
            try { this._ticketsSpreadsheet = SpreadsheetApp.openById( id ); }
            catch ( e ) { console.warn( `BidderManager: could not open tickets sheet. ${ e.message }` ); return null; }
        }
        return this._ticketsSpreadsheet;
    }

    get ticketBidders () {
        if ( !this._ticketBidders )
            this._ticketBidders = this._getTicketPackage( this.auctionTicketsString );
        return this._ticketBidders;
    }
    get staffBidders () {
        if ( !this._staffBidders )
            this._staffBidders = this._getTicketPackage( this.auctionStaffTicketsString );
        return this._staffBidders;
    }
    get sponsorBidders () {
        if ( !this._sponsorBidders )
            this._sponsorBidders = this._getTicketPackage( this.auctionSponsorTicketsString );
        return this._sponsorBidders;
    }

    // ── Sheet-setup orchestration ────────────────────────────────────────────
    /**
     * Main entry point. Gathers all bidders in memory, batch-writes them to
     * the Bidder-Numbers sheet, inserts checkboxes, and assigns IDs.
     * Guards against overwriting an already-populated sheet.
     */
    copyBiddersToBidderSheet () {
        const s = this.uiManager.strings;

        let sheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        if ( !sheet ) sheet = this.activeSpreadSheet.insertSheet( this.bidNumbersString );

        if ( sheet.getLastRow() > 1 ) {
            this.uiManager.showAlert( s.setupCancelledTitle, s.setupCancelledMsg );
            return;
        }

        sheet.getRange( 1, 1, 1, 11 ).setValues( [ [
            this.idString, this.firstNameString, this.lastNameString, this.emailString,
            this.checkedInString, this.proxyBidderString, this.checkedOutString, this.paidString, this.paymentMethod, this.invoiceURL, this.invoicedAmount
        ] ] );
        sheet.setFrozenRows( 1 );

        this.collectedBidders = [];
        this._collectStaffBidders_();
        this._collectPrimaryTicketBidders_();
        this._collectGuestTickets_();
        this._collectSponsorBidders_();

        const totalBidders = this.collectedBidders.length;

        if ( totalBidders > 0 ) {
            sheet.getRange( 2, 2, totalBidders, 3 ).setValues( this.collectedBidders );
            sheet.getRange( 2, 5, totalBidders, 4 ).insertCheckboxes();
            this.lastRowPosition_ = totalBidders + 1;
        }

        // this.removeExtraColumns_(sheet);
        this.setBidderNumbers_( sheet, totalBidders );
    }

    _collectStaffBidders_ () {
        const data = this.staffBidders;
        for ( let i = 0; i < data.loopLength; i++ ) {
            this.collectedBidders.push( [ data.range[ i ][ 0 ], data.range[ i ][ 1 ], data.range[ i ][ 2 ] ] );
        }
    }

    _collectPrimaryTicketBidders_ () {
        const data = this.ticketBidders;
        for ( let i = 0; i < data.loopLength; i++ ) {
            this.collectedBidders.push( [ data.range[ i ][ 0 ], data.range[ i ][ 1 ], data.range[ i ][ 2 ] ] );
        }
    }

    _collectGuestTickets_ () {
        // Passing arguments as: First Name Col, Last Name Col, Email Col, "Own Bidder?" Col
        this._collectGuestInfo_( 7, 8, 9, 10 );    // Guest 1 
        this._collectGuestInfo_( 11, 12, 13, 14 ); // Guest 2 (Indexes shifted)
        this._collectGuestInfo_( 15, 16, 17, 18 ); // Guest 3 (Indexes shifted)
    }

    _collectGuestInfo_ ( firstNameCol, lastNameCol, emailCol, ownBidderCol ) {
        const data = this.ticketBidders;
        for ( let i = 0; i < data.loopLength; i++ ) {

            // First check if they have guests and a guest first name exists
            if ( data.range[ i ][ 6 ] !== '' && data.range[ i ][ firstNameCol ] !== '' ) {

                // Fetch the "Own Bidder Number?" response
                const wantsOwnNumber = data.range[ i ][ ownBidderCol ];

                // Only push to collectedBidders if they explicitly answered "yes"
                if ( wantsOwnNumber && wantsOwnNumber.toString().trim().toLowerCase() === 'yes' ) {
                    this.collectedBidders.push( [
                        data.range[ i ][ firstNameCol ],
                        data.range[ i ][ lastNameCol ],
                        data.range[ i ][ emailCol ]
                    ] );
                }
            }
        }
    }

    _collectSponsorBidders_ () {
        const data = this.sponsorBidders;
        for ( let i = 0; i < data.loopLength; i++ ) {
            this.collectedBidders.push( [ data.range[ i ][ 0 ], data.range[ i ][ 1 ], data.range[ i ][ 2 ] ] );
        }
    }

    removeExtraColumns_ ( sheet ) {
        const maxCols = sheet.getMaxColumns();
        if ( maxCols > 9 ) sheet.deleteColumns( 10, maxCols - 9 );
    }

    setBidderNumbers_ ( sheet, totalBidders ) {
        if ( totalBidders <= 0 ) return;
        const ids = Array.from( { length: totalBidders }, ( _, i ) => [ 101 + i ] );
        sheet.getRange( 2, 1, totalBidders, 1 ).setValues( ids );
    }

    /**
     * Sorts the Bidder-Numbers sheet by last name (column 3) in ascending order.
     * Called by ReceiptManager before batch receipt generation so receipts are
     * printed in alphabetical order.
     */
    sortByLastName_ () {
        const sheet = this.bidders.sheet;
        if ( sheet && sheet.getLastRow() > 1 ) {
            sheet.getRange( 2, 1, sheet.getLastRow() - 1, sheet.getLastColumn() ).sort( 3 );
        }
    }

    /**
     * Returns the full Bidder-Numbers sheet data sorted alphabetically by last name
     * (column index 2, zero-based) entirely in memory — the underlying sheet is
     * never modified.
     *
     * The returned array preserves the header row at index 0, matching the shape
     * that getDataRange().getValues() would normally return, so callers can use
     * the same index arithmetic they would against the raw sheet data.
     *
     * @returns {Array[][]} Header row + sorted data rows, or an empty array if
     *                      the sheet is missing or contains only a header.
     */
    getSortedBidderData_ () {
        const sheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        if ( !sheet || sheet.getLastRow() <= 1 ) return [];

        const allData = sheet.getDataRange().getValues();
        const header = allData[ 0 ];
        const dataRows = allData.slice( 1 );

        dataRows.sort( ( a, b ) => {
            const lastA = ( a[ 2 ] || '' ).toString().toLowerCase();
            const lastB = ( b[ 2 ] || '' ).toString().toLowerCase();
            return lastA.localeCompare( lastB );
        } );

        return [ header, ...dataRows ];
    }
}

function setupBiddersSheet () { new BidderManager().copyBiddersToBidderSheet(); }