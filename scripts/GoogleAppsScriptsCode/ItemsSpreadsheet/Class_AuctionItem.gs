/**
 * Data model for a single auction item row.
 * Constructed from a raw sheet row array; provides named properties and
 * simple helper methods. Has no knowledge of sheets, docs, or UI.
 */
class AuctionItem {
    /**
     * @param {Array} rowData  A single row from the Auction-Items data range.
     */
    constructor ( rowData ) {
        // NULL PROTECTION: the Sheets API omits trailing empty cells from a
        // row, so a row with no bundle/timestamp data can arrive shorter
        // than 12 columns - default any missing trailing cell to '' so the
        // `=== ''` fallback checks below (getDisplayValue/getDisplayOpeningBid/
        // getDisplayMinRaise) still work as designed, instead of comparing
        // against `undefined`.
        const cell = ( i ) => ( rowData[ i ] !== undefined && rowData[ i ] !== null ) ? rowData[ i ] : '';

        this.id = cell( 0 ).toString();
        this.category = cell( 1 );
        this.name = cell( 2 );
        this.description = cell( 3 );
        this.value = cell( 4 );
        this.openingBid = cell( 5 );
        this.minRaise = cell( 6 );
        this.donatedBy = cell( 7 );
        this.phyOrCert = cell( 8 );
        this.status = cell( 9 );
        this.bundleID = cell( 10 );
        this.bundleTimeStamp = cell( 11 );
    }

    /** Returns true when the item belongs to the Live auction category. */
    isLive () { return this.category === 'Live'; }

    /** Returns true when an explicit opening bid has been set. */
    hasOpeningBid () { return this.openingBid !== ''; }

    /** Returns the display value, falling back to '500' for items without one. */
    getDisplayValue () { return this.value === '' ? '500' : this.value; }

    /** Returns the display opening bid, falling back to '5'. */
    getDisplayOpeningBid () { return this.openingBid === '' ? '5' : this.openingBid; }

    /** Returns the display minimum raise, falling back to '5'. */
    getDisplayMinRaise () { return this.minRaise === '' ? '5' : this.minRaise; }

    /**
     * Reconstructs a real AuctionItem from a plain data object - the
     * shape server/services/itemDataService.ts's getValidSortedItems
     * already resolved, passed in here as an Apps Script API parameter
     * instead of this class reading/filtering/sorting the sheet itself.
     * Field names differ from this class's own (donor -> donatedBy,
     * itemType -> phyOrCert, bundleId -> bundleID,
     * bundledDateTime -> bundleTimeStamp) because Node's resolver reuses
     * src/lib/itemParsing.ts's existing `AuctionItem` shape (src/types.ts)
     * rather than re-encoding this class's field names a second time.
     * See docs/agents/refactor-opportunities.md's Code Hardening item #3
     * / CHANGELOG.md.
     * @param {Object} data
     * @returns {AuctionItem}
     */
    static fromData ( data ) {
        const item = Object.create( AuctionItem.prototype );
        const cell = ( v ) => ( v !== undefined && v !== null ) ? v : '';

        item.id = cell( data.id ).toString();
        item.category = cell( data.category );
        item.name = cell( data.name );
        item.description = cell( data.description );
        item.value = cell( data.value );
        item.openingBid = cell( data.openingBid );
        item.minRaise = cell( data.minRaise );
        item.donatedBy = cell( data.donor );
        item.phyOrCert = cell( data.itemType );
        item.status = cell( data.status );
        item.bundleID = cell( data.bundleId );
        item.bundleTimeStamp = cell( data.bundledDateTime );

        return item;
    }
}