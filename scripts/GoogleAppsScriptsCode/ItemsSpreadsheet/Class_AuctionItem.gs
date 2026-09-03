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
        this.id = rowData[ 0 ].toString();
        this.category = rowData[ 1 ];
        this.name = rowData[ 2 ];
        this.description = rowData[ 3 ];
        this.value = rowData[ 4 ];
        this.openingBid = rowData[ 5 ];
        this.minRaise = rowData[ 6 ];
        this.donatedBy = rowData[ 7 ];
        this.phyOrCert = rowData[ 8 ];
        this.status = rowData[ 9 ];
        this.bundleID = rowData[ 10 ];
        this.bundleTimeStamp = rowData[ 11 ];
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
}