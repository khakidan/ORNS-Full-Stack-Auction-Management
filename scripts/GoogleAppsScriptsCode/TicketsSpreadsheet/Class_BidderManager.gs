/**
 * Data manager. Extends GlobalVariables for spreadsheet access and the
 * sheet-name constants (staffTicketsString, ticketsString, sponsorString).
 *
 * Responsible for reading all three ticket sheets and returning a flat
 * array of Bidder instances, each carrying the REAL bidder number already
 * assigned by the Bid-Management app's sync (server/services/syncService.ts,
 * `performSheetSync()`), read directly from that spreadsheet's
 * "Bidder-Numbers" tab.
 *
 * This class deliberately does NOT invent bidder numbers itself. Printed
 * labels are physically affixed to bidding guides before the auction and
 * the numbers on them must match the numbers the app uses to record bids —
 * so there must be exactly one source of truth (Bidder-Numbers), and this
 * class only looks numbers up in it.
 */
class BidderManager extends GlobalVariables {
    /**
     * @param {Object} [overrides]
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [overrides.bidManagementSpreadsheet]
     *   Used by unit tests to skip the real `SpreadsheetApp.openById` call in
     *   loadBidderNumberMap_ entirely. Production call sites never pass this.
     */
    constructor ( overrides = {} ) {
        super( overrides );
        this.bidManagementSpreadsheetOverride_ = overrides.bidManagementSpreadsheet || null;
    }

    /**
     * Reads a named sheet and returns its data rows (skipping the header).
     * Returns an empty array when the sheet is missing or has no data rows.
     * @param {string} sheetName
     * @returns {Array[]}
     */
    getSheetData_ ( sheetName ) {
        const sheet = this.activeSpreadSheet.getSheetByName( sheetName );
        if ( !sheet || sheet.getLastRow() < 2 ) return [];
        return sheet.getRange( 2, 1, sheet.getLastRow() - 1, sheet.getLastColumn() ).getValues();
    }

    /**
     * Normalizes a (first, last, email) triple into the same match key used
     * by server/services/syncService.ts's performSheetSync(): each name part
     * capitalized-first/lowercased-rest, email lowercased/trimmed, joined
     * with "|". Must stay byte-for-byte identical to that implementation —
     * this is the only thing that lets a printed label be matched back to
     * its real Bidder-Numbers row.
     * @param {string} first
     * @param {string} last
     * @param {string} email
     * @returns {string}
     */
    matchKey_ ( first, last, email ) {
        const formatName = ( str ) => {
            const cleaned = ( str || '' ).toString().trim();
            if ( !cleaned ) return '';
            return cleaned.charAt( 0 ).toUpperCase() + cleaned.slice( 1 ).toLowerCase();
        };
        const emailPart = ( email || '' ).toString().toLowerCase().trim();
        return formatName( first ) + '|' + formatName( last ) + '|' + emailPart;
    }

    /**
     * Opens the Bid-Management spreadsheet and builds a { matchKey: id }
     * map from its "Bidder-Numbers" tab (columns A=ID, B=First, C=Last,
     * D=Email — see syncService.ts's bidderNumbersHeader).
     * @param {string} bidManagementSpreadsheetId
     * @returns {Object<string, string>}
     */
    loadBidderNumberMap_ ( bidManagementSpreadsheetId ) {
        const ss = this.bidManagementSpreadsheetOverride_ || SpreadsheetApp.openById( bidManagementSpreadsheetId );
        const sheet = ss.getSheetByName( 'Bidder-Numbers' );
        const map = {};
        if ( !sheet || sheet.getLastRow() < 2 ) return map;

        const rows = sheet.getRange( 2, 1, sheet.getLastRow() - 1, 4 ).getValues();
        rows.forEach( row => {
            const [ id, first, last, email ] = row;
            if ( !id ) return;
            map[ this.matchKey_( first, last, email ) ] = id.toString();
        } );
        return map;
    }

    /**
     * Assembles and returns every bidder across all three ticket sheets,
     * with each bidder's number looked up from the Bid-Management app's
     * "Bidder-Numbers" sheet (the single source of truth).
     *
     * Sheet order (unchanged from the original implementation — only the
     * source of the NUMBER changed, not which people are considered):
     *   staff tickets → tickets → sponsor tickets
     * Guest columns (tickets sheet only — corrected to match
     * src/lib/attendeeParsing.ts / syncService.ts's collectGuestInfo shift):
     *   - Guest 1: columns H, I, J     (index 7, 8, 9)
     *   - Guest 2: columns L, M, N     (index 11, 12, 13)
     *   - Guest 3: columns P, Q, R     (index 15, 16, 17)
     * A guest is only included if they explicitly opted in ("yes" in their
     * own-bidder-number flag column), matching syncService.ts's behavior —
     * staff and sponsors never have guests, by design.
     *
     * Any PRIMARY bidder (staff, ticket buyer, or sponsor) who can't be
     * matched in Bidder-Numbers is a hard error: it means "Set Up Bid
     * Management App" hasn't been run since this person was added, and
     * printing a label for them would either fail or — worse — print no
     * number / a wrong number. Unmatched GUESTS are silently skipped since
     * not opting in for their own number is the normal, expected case.
     *
     * @param {string} bidManagementSpreadsheetId Required — the Bid-Management
     *   spreadsheet ID to read the real bidder numbers from.
     * @returns {Bidder[]} Sorted ascending by bidder number.
     */
    getAllBidders ( bidManagementSpreadsheetId ) {
        if ( !bidManagementSpreadsheetId ) {
            throw new Error( 'getAllBidders requires a Bid-Management spreadsheet ID.' );
        }

        const numberMap = this.loadBidderNumberMap_( bidManagementSpreadsheetId );
        if ( Object.keys( numberMap ).length === 0 ) {
            throw new Error(
                'The Bid-Management spreadsheet has no Bidder-Numbers data. ' +
                'Run "Set Up Bid Management App" before printing bidder labels.'
            );
        }

        const bidders = [];
        const unmatchedPrimary = [];

        const tryAddPrimary = ( first, last, email ) => {
            first = ( first || '' ).toString().trim();
            last = ( last || '' ).toString().trim();
            if ( !first && !last ) return;
            const id = numberMap[ this.matchKey_( first, last, email ) ];
            if ( id === undefined ) {
                unmatchedPrimary.push( `${ first } ${ last }`.trim() );
                return;
            }
            bidders.push( new Bidder( `${ first } ${ last }`.trim(), id ) );
        };

        const tryAddGuest = ( first, last, email ) => {
            first = ( first || '' ).toString().trim();
            last = ( last || '' ).toString().trim();
            if ( !first && !last ) return;
            const id = numberMap[ this.matchKey_( first, last, email ) ];
            if ( id === undefined ) return; // not opted in / not synced — expected
            bidders.push( new Bidder( `${ first } ${ last }`.trim(), id ) );
        };

        [ this.staffTicketsString, this.ticketsString, this.sponsorString ].forEach( sheetName => {
            const rows = this.getSheetData_( sheetName );

            rows.forEach( row => {
                // Primary bidder — columns A, B, C (index 0, 1, 2) on every sheet
                tryAddPrimary( row[ 0 ], row[ 1 ], row[ 2 ] );

                // tickets sheet only: up to 3 additional guest triples
                if ( sheetName === this.ticketsString ) {
                    tryAddGuest( row[ 7 ], row[ 8 ], row[ 9 ] );
                    tryAddGuest( row[ 11 ], row[ 12 ], row[ 13 ] );
                    tryAddGuest( row[ 15 ], row[ 16 ], row[ 17 ] );
                }
            } );
        } );

        if ( unmatchedPrimary.length > 0 ) {
            throw new Error(
                'The following people could not be matched to a Bidder-Numbers entry: ' +
                unmatchedPrimary.join( ', ' ) +
                '. Run "Set Up Bid Management App" to sync bidder numbers before printing labels.'
            );
        }

        bidders.sort( ( a, b ) => parseInt( a.getNumber(), 10 ) - parseInt( b.getNumber(), 10 ) );
        return bidders;
    }
}
