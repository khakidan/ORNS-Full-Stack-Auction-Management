/**
 * Data manager. Handles the live auction check-in workflow:
 *   - Searching for a bidder by last name and marking them as present
 *   - Processing walk-in ticket purchases (adds a new bidder row and
 *     a new column pair in the Bid-Management sheet)
 *
 * Extracted from AuctionWorkflowManager. Extends GlobalStyles because
 * processNewTicketPurchase_ uses this.bandingColors for column formatting.
 */
class CheckInManager extends GlobalStyles {
    constructor () {
        super();
        this.uiManager = new UIManager();
        this.bidderManager = new BidderManager();

        this.walkInTicketItemId = 1606;
        const rawPrice = this.config[ 'ticketPrice' ] || 35;
        this.walkInTicketPrice = parseFloat( rawPrice.toString().replace( /[^0-9.]/g, '' ) );
    }

    // ── Bid-Management sheet accessor ─────────────────────────────────────────
    /**
     * Lazy-loads and caches the Bid-Management sheet data.
     * Needed by processNewTicketPurchase_ to append new bidder columns.
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

    // ── Check-in workflow ─────────────────────────────────────────────────────
    /**
     * Searches the Bidder-Numbers sheet by last name and marks the bidder as
     * checked in. If multiple matches exist, prompts for a first name to narrow
     * down. Offers to process a walk-in ticket purchase if no match is found.
     */
    startCheckInProcess () {
        const s = this.uiManager.strings;
        const bidderSheet = this.bidderManager.bidders.sheet;

        let searchLastName = '';
        while ( true ) {
            const searchLastNameText = this.uiManager.promptOkCancel(
                s.checkInTitle, s.checkInLastNamePrompt
            );
            if ( searchLastNameText === null ) return;

            searchLastName = searchLastNameText.trim().toLowerCase();
            if ( searchLastName !== '' ) break;

            this.uiManager.showAlert( s.invalidInputTitle, s.blankLastNameMsg );
        }

        const data = bidderSheet.getDataRange().getValues();
        const matches = [];
        for ( let i = 1; i < data.length; i++ ) {
            if ( data[ i ][ 2 ] && data[ i ][ 2 ].toString().toLowerCase() === searchLastName ) {
                matches.push( {
                    row: i + 1,
                    id: data[ i ][ 0 ],
                    first: data[ i ][ 1 ],
                    last: data[ i ][ 2 ],
                    status: data[ i ][ 4 ]
                } );
            }
        }

        let selectedBidder = null;

        if ( matches.length === 1 ) {
            selectedBidder = matches[ 0 ];
        } else if ( matches.length > 1 ) {
            while ( true ) {
                const searchFirstNameText = this.uiManager.promptOkCancel(
                    s.multipleMatchesTitle,
                    s.multipleMatchesPrompt( matches.length )
                );
                if ( searchFirstNameText === null ) return;

                const searchFirstName = searchFirstNameText.trim().toLowerCase();
                if ( searchFirstName === '' ) {
                    this.uiManager.showAlert( s.invalidInputTitle, s.blankFirstNameMsg );
                    continue;
                }

                selectedBidder = matches.find(
                    b => b.first.toString().toLowerCase() === searchFirstName
                );

                if ( selectedBidder ) break;

                const tryAgain = this.uiManager.confirmYesNo(
                    s.noMatchTitle,
                    s.noFirstNameMatchMsg( searchFirstNameText.trim() )
                );
                if ( !tryAgain ) break;
            }
        }

        if ( selectedBidder ) {
            if ( selectedBidder.status === true ) {
                this.uiManager.showAlert(
                    s.alreadyCheckedInTitle,
                    s.alreadyCheckedInMsg( selectedBidder.first, selectedBidder.last )
                );
                return;
            }
            bidderSheet.getRange( selectedBidder.row, 5 ).setValue( true );
            this.uiManager.showAlert(
                s.checkInCompleteTitle,
                s.checkInCompleteMsg( selectedBidder.first, selectedBidder.last )
            );
        } else {
            if ( this.uiManager.confirmYesNo( s.bidderNotFoundTitle, s.bidderNotFoundWalkInMsg ) ) {
                this.processNewTicketPurchase_( searchLastName );
            }
        }
    }

    /**
     * Handles walk-in ticket purchases:
     *   - Collects first name, last name, and optional email address
     *   - Adds a new row to the Bidder-Numbers sheet (checked in immediately)
     *   - Adds a new two-column pair to the Bid-Management sheet with the
     *     walk-in ticket pre-populated as their first item
     * @param {string} lastName  The last name from the failed search.
     */
    processNewTicketPurchase_ ( lastName ) {
        const s = this.uiManager.strings;
        const bidderSheet = this.bidderManager.bidders.sheet;
        const bidMgmtSheet = this.bidManagement.sheet;
        const data = bidderSheet.getDataRange().getValues();

        let firstName = '';
        while ( true ) {
            const firstNameText = this.uiManager.promptOkCancel( s.newTicketTitle, s.newTicketFirstNamePrompt );
            if ( firstNameText === null ) return;

            firstName = firstNameText.trim();
            if ( firstName !== '' ) break;

            this.uiManager.showAlert( s.invalidInputTitle, s.blankFirstNameMsg );
        }

        const emailText = this.uiManager.promptOkCancel( s.newTicketTitle, s.newTicketEmailPrompt );
        if ( emailText === null ) return;

        const formatName = str => str ? str.charAt( 0 ).toUpperCase() + str.slice( 1 ).toLowerCase() : '';
        const formattedFirst = formatName( firstName );
        const formattedLastName = formatName( lastName.trim() );
        const email = emailText.trim();

        const maxId = data.slice( 1 ).reduce( ( max, row ) => Math.max( max, parseInt( row[ 0 ] ) || 0 ), 100 );
        const newId = maxId + 1;
        const newRow = bidderSheet.getLastRow() + 1;

        bidderSheet.getRange( newRow, 1, 1, 4 ).setValues( [ [ newId, formattedFirst, formattedLastName, email ] ] );
        bidderSheet.getRange( newRow, 5, 1, 4 ).insertCheckboxes();
        bidderSheet.getRange( newRow, 5 ).setValue( true );

        const lastCol = bidMgmtSheet.getLastColumn();
        bidMgmtSheet.insertColumnsAfter( lastCol, 2 );
        const newCol = lastCol + 1;

        bidMgmtSheet.getRange( 1, newCol ).setValue( newId );
        bidMgmtSheet.getRange( 2, newCol, 1, 2 ).setValues( [ [ formattedFirst, formattedLastName ] ] ).setFontWeight( 'bold' );
        bidMgmtSheet.getRange( 3, newCol, 1, 2 ).setValues( [ [ 'Item #:', 'Price:' ] ] );
        bidMgmtSheet.getRange( 1, newCol, 1, 2 ).mergeAcross().setHorizontalAlignment( 'center' );
        bidMgmtSheet.getRange( 4, newCol, 1, 2 ).setValues( [ [ this.walkInTicketItemId, this.walkInTicketPrice ] ] );

        // const currentBidderCount = Math.floor(lastCol / 2);
        // const nextColor          = this.bandingColors[currentBidderCount % this.bandingColors.length];

        // const prevRange    = bidMgmtSheet.getRange(1, lastCol - 1, bidMgmtSheet.getMaxRows(), 2);
        // const prevBandings = prevRange.getBandings();
        // if (prevBandings.length > 0) {
        // const prevBanding        = prevBandings[0];
        // const prevFirstColorObj  = prevBanding.getFirstRowColorObject();
        // const prevSecondColorObj = prevBanding.getSecondRowColorObject();
        // prevBanding.remove();
        // try {
        // prevRange.applyRowBanding()
        // .setFirstRowColorObject(prevFirstColorObj)
        // .setSecondRowColorObject(prevSecondColorObj);
        // } catch (e) {
        // console.warn(`Could not reapply banding to col ${lastCol - 1}: ${e.message}`);
        // }
        // }

        // try {
        //     bidMgmtSheet.getRange(1, newCol, bidMgmtSheet.getMaxRows(), 2)
        //         .applyRowBanding()
        //         .setFirstRowColor(nextColor)
        //         .setSecondRowColor('#ffffff');
        // } catch (e) {
        //     console.warn(`Could not apply banding to new col ${newCol}: ${e.message}`);
        // }

        this.uiManager.showAlert(
            s.walkInCreatedTitle,
            s.walkInCreatedMsg( newId, formattedFirst, formattedLastName, email )
        );
    }
}

function startCheckInProcess () { new CheckInManager().startCheckInProcess(); }