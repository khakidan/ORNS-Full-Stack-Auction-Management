/**
 * Data manager. Extends GlobalVariables for spreadsheet access.
 *
 * Responsibilities:
 *   - Lazy-load and own the Auction-Items sheet data
 *   - Import the master item sheet from the external import workbook if needed
 *   - Append standard raffle/appeal/ticket items
 *   - Clean up extra columns from the imported sheet
 *   - Provide item-name lookup by ID for receipt generation
 */
class AuctionItemManager extends GlobalVariables {
    constructor () {
        super();
    }

    // ── Sheet data getter ────────────────────────────────────────────────────
    /** Lazy-loads and caches the Auction-Items sheet data. */
    get auctionItems () {
        if ( this._auctionItems ) return this._auctionItems;
        const sheet = this.activeSpreadSheet.getSheetByName( this.auctionItemsString );
        if ( !sheet ) return { sheet: null, lastRow: 0, lastCol: 0, range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 1
            ? sheet.getRange( 2, 1, lastRow - 1, lastCol ).getValues()
            : [];

        this._auctionItems = { sheet, lastRow, lastCol, range: dataRange, loopLength: Math.max( 0, lastRow - 1 ) };
        return this._auctionItems;
    }

    // ── Setup helpers (called by AuctionWorkflowManager during sheet setup) ──
    /**
     * Imports the Auction-Items sheet from the external workbook if it doesn't
     * exist locally yet.
     */
    ensureAuctionItemsSheet () {
        let sheet = this.activeSpreadSheet.getSheetByName( this.auctionItemsString );
        if ( !sheet ) {
            const importWorkbook = this.getAuctionImportSheet_();
            if ( importWorkbook ) {
                sheet = importWorkbook.getSheets()[ 0 ].copyTo( this.activeSpreadSheet ).setName( this.auctionItemsString );
            }
        }
        return sheet;
    }

    getAuctionImportSheet_ () {
        const id = this.config[ 'auctionImportSheetID' ];
        if ( !id || id.toString().includes( 'PASTE' ) ) return null;
        try { return SpreadsheetApp.openById( id ); }
        catch ( e ) { console.warn( `AuctionItemManager: could not open import sheet. ${ e.message }` ); return null; }
    }

    /**
     * Appends standard raffle, appeal, and ticket items to the Auction-Items sheet.
     */
    addStandardAuctionItems_ () {
        const sheet = this.auctionItems.sheet;
        if ( !sheet ) return;

        const lastRow = sheet.getLastRow();
        const standardItems = [
            [ 1401, 'A Night with the ORNS Staff', '' ],
            [ 1501, 'One Raffle Ticket for a $500 Amazon Gift Card', '' ],
            [ 1502, 'Five Raffle Tickets for a $500 Amazon Gift Card', '' ],
            [ 1503, 'Ten Raffle Tickets for a $500 Amazon Gift Card', '' ],
            [ 1504, 'One 50/50 Raffle Ticket $20', '' ],
            [ 1601, 'Open Appeal for $500', '' ],
            [ 1602, 'Open Appeal for $250', '' ],
            [ 1603, 'Open Appeal for $100', '' ],
            [ 1604, 'Open Appeal for $50', '' ],
            [ 1605, 'Open Appeal for $25', '' ],
            [ 1606, 'Auction Tickets', '' ]
        ];

        sheet.getRange( lastRow + 1, 1, standardItems.length, 3 ).setValues( standardItems );
    }

    /**
     * Deletes unnecessary columns from the imported Auction-Items sheet.
     */
    removeExtraAuctionItemInfo_ () {
        const sheet = this.auctionItems.sheet;
        if ( sheet && sheet.getLastColumn() >= 10 ) {
            sheet.deleteColumns( 5, 5 );
            sheet.deleteColumns( 2, 2 );
        }
    }

    /**
     * Looks up an item name by ID. Returns 'Unknown Item' on no match.
     * @param {string|number} id
     * @returns {string}
     */
    getItemName ( id ) {
        const normalizedId = parseFloat( id ).toString(); // "1503.0" → "1503", "1503" → "1503"
        const { range, loopLength } = this.auctionItems;
        for ( let i = 0; i < loopLength; i++ ) {
            if ( parseFloat( range[ i ][ 0 ] ).toString() === normalizedId ) return range[ i ][ 1 ];
        }
        return 'Unknown Item';
    }
}