/**
 * Data manager. Extends GlobalVariables for spreadsheet access.
 * Responsible for lazy-loading the full Auction-Items data range and
 * exposing individual AuctionItem instances to Document Generators.
 */
class AuctionItemManager extends GlobalVariables {
    constructor () {
        super();
        this.auctionItemsString = 'Auction-Items';
    }

    /**
     * Lazy-loads and caches the Auction-Items sheet data.
     * Returns a structured object so callers always get consistent shape.
     */
    get auctionItems () {
        if ( this._auctionItems ) return this._auctionItems;

        const sheet = this.activeSpreadSheet.getSheetByName( this.auctionItemsString );
        if ( !sheet ) return { sheet: null, lastRow: 0, lastCol: 0, range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 1
            ? sheet.getRange( 2, 1, lastRow - 1, lastCol ).getValues()
            : [];

        this._auctionItems = {
            sheet,
            lastRow,
            lastCol,
            range: dataRange,
            loopLength: Math.max( 0, lastRow - 1 )
        };
        return this._auctionItems;
    }

    /**
     * Returns a fully constructed AuctionItem for the given zero-based index.
     * @param {number} i
     * @returns {AuctionItem}
     */
    getAuctionItemAtIndex_ ( i ) {
        return new AuctionItem( this.auctionItems.range[ i ] );
    }

    /**
     * Retrieves all valid items (ignoring 'inactive' and 'deleted' in Column J / index 9)
     * and sorts them alphabetically (A-Z) by their ID.
     */
    getValidSortedItems () {
        const validItems = [];

        // Loop through raw spreadsheet data
        for ( let i = 0; i < this.auctionItems.loopLength; i++ ) {
            // Column J is index 9 (0-indexed base)
            const status = ( this.auctionItems.range[ i ][ 9 ] || '' ).toString().toLowerCase().trim();
            if ( status !== 'inactive' && status !== 'deleted' ) {
                validItems.push( this.getAuctionItemAtIndex_( i ) );
            }
        }

        // Sort numerically by item ID so 100s → 200s → ... → 900s → 1000s → 1100s → 1300s
        validItems.sort( function ( a, b ) {
            return parseInt( a.id, 10 ) - parseInt( b.id, 10 );
        } );

        return validItems;
    }
}