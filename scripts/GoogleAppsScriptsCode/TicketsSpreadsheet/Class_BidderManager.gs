/**
 * Data manager. Extends GlobalVariables for spreadsheet access and the
 * sheet-name constants (staffTicketsString, ticketsString, sponsorString).
 *
 * Responsible for reading all three ticket sheets and returning a flat,
 * ordered array of Bidder instances with numbers pre-assigned.
 */
class BidderManager extends GlobalVariables {
    constructor () {
        super();
        this.baseBidderNumber = 101; // First bidder gets number 101
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
     * Assembles and returns every bidder across all three ticket sheets as an
     * ordered array of Bidder instances with sequential numbers pre-assigned.
     *
     * Sheet order: staff tickets → tickets → sponsor tickets
     * Guest columns (tickets sheet only):
     *   - Guest 1: columns H & I  (index 7 & 8)
     *   - Guest 2: columns K & L  (index 10 & 11)
     *   - Guest 3: columns N & O  (index 13 & 14)
     *
     * @returns {Bidder[]}
     */
    getAllBidders () {
        const bidders = [];
        let nextNumber = this.baseBidderNumber;

        [ this.staffTicketsString, this.ticketsString, this.sponsorString ].forEach( sheetName => {
            const rows = this.getSheetData_( sheetName );

            rows.forEach( row => {
                // Primary bidder — columns A & B (index 0 & 1) on every sheet
                if ( row[ 0 ] || row[ 1 ] ) {
                    bidders.push( new Bidder( `${ row[ 0 ] } ${ row[ 1 ] }`.trim(), nextNumber++ ) );
                }

                // tickets sheet only: check for up to 3 additional guest pairs
                if ( sheetName === this.ticketsString ) {
                    if ( row[ 7 ] || row[ 8 ] ) bidders.push( new Bidder( `${ row[ 7 ] }  ${ row[ 8 ] }`.trim(), nextNumber++ ) );
                    if ( row[ 10 ] || row[ 11 ] ) bidders.push( new Bidder( `${ row[ 10 ] } ${ row[ 11 ] }`.trim(), nextNumber++ ) );
                    if ( row[ 13 ] || row[ 14 ] ) bidders.push( new Bidder( `${ row[ 13 ] } ${ row[ 14 ] }`.trim(), nextNumber++ ) );
                }
            } );
        } );

        return bidders;
    }
}