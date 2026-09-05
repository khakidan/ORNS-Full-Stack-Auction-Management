/**
 * Data manager. Extends GlobalVariables for spreadsheet access.
 *
 * Looks up an item's name by ID from the separate Auction Items
 * spreadsheet - the single source of truth - instead of a local copy
 * that used to live inside this spreadsheet. That local copy was a
 * lossy, one-time snapshot (3 columns, Active-only, taken once when
 * "Set Up Bid Management App" ran) that silently went stale the moment
 * anything changed in the real Items spreadsheet afterward - see
 * docs/agents/refactor-opportunities.md's Code Hardening item #1 and
 * CHANGELOG.md for the full history.
 */
class AuctionItemManager extends GlobalVariables {
    /**
     * @param {Object} [overrides] Optional dependency/config injection, used
     *   by unit tests. Forwarded to `GlobalVariables` (activeSpreadSheet/
     *   config) plus an optional `itemsSpreadsheet` that replaces the real
     *   `SpreadsheetApp.openById(this.config['auctionImportSheetID'])` call
     *   entirely. Production call sites (`new AuctionItemManager()`) never
     *   pass this.
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [overrides.itemsSpreadsheet]
     */
    constructor ( overrides = {} ) {
        super( overrides );
        this.itemsSpreadsheetOverride_ = overrides.itemsSpreadsheet || null;
    }

    /**
     * Opens the master Auction Items spreadsheet
     * (`this.config['auctionImportSheetID']`, already loaded from this
     * spreadsheet's own _Settings tab by GlobalVariables) and builds an
     * `{ id: name }` map from its "Auction-Items" sheet - falling back to
     * the workbook's first tab if that name doesn't exist, mirroring
     * server/services/syncService.ts's own fallback. Read positionally per
     * the schema documented in
     * scripts/GoogleAppsScriptsCode/ItemsSpreadsheet/Class_AuctionItem.gs:
     * id = column A (index 0), name = column C (index 2) - a fixed,
     * already-documented layout, so no header-sniffing is needed.
     *
     * Throws on any systemic problem (missing/blank ID, the spreadsheet
     * failing to open, or a successful-but-empty read) rather than
     * silently printing "Unknown Item" on every line of every receipt -
     * mirroring scripts/GoogleAppsScriptsCode/TicketsSpreadsheet/
     * Class_BidderManager.gs's own cross-spreadsheet-read precedent.
     * @returns {Object<string, string>}
     */
    loadItemNameMap_ () {
        const id = this.config[ 'auctionImportSheetID' ];
        if ( !this.itemsSpreadsheetOverride_ && ( !id || id.toString().includes( 'PASTE' ) ) ) {
            throw new Error( 'Missing the Auction Items spreadsheet ID (auctionImportSheetID) - configure it in Settings before generating receipts.' );
        }

        let ss;
        try {
            ss = this.itemsSpreadsheetOverride_ || SpreadsheetApp.openById( id );
        } catch ( e ) {
            throw new Error( `Could not open the Auction Items spreadsheet: ${ e.message }` );
        }

        const sheet = ss.getSheetByName( 'Auction-Items' ) || ss.getSheets()[ 0 ];
        if ( !sheet ) {
            throw new Error( 'The Auction Items spreadsheet has no sheets to read items from.' );
        }

        const lastRow = sheet.getLastRow();
        if ( lastRow < 2 ) {
            throw new Error( 'The Auction Items spreadsheet has no item data.' );
        }

        const rows = sheet.getRange( 2, 1, lastRow - 1, 3 ).getValues();
        const map = {};
        rows.forEach( row => {
            const itemId = row[ 0 ];
            if ( itemId === '' || itemId === null || itemId === undefined ) return;
            map[ parseFloat( itemId ).toString() ] = row[ 2 ];
        } );
        return map;
    }

    /**
     * Looks up an item name by ID, lazily loading and caching the name map
     * on first use (so a batch of receipts only opens/reads the Items
     * spreadsheet once). Returns 'Unknown Item' when the (successfully
     * read) map simply has no entry for this ID - a genuine per-item data
     * issue, not a systemic one.
     * @param {string|number} id
     * @returns {string}
     */
    getItemName ( id ) {
        if ( !this._itemNameMap ) this._itemNameMap = this.loadItemNameMap_();

        const normalizedId = parseFloat( id ).toString(); // "1503.0" → "1503", "1503" → "1503"
        const name = this._itemNameMap[ normalizedId ];
        return name !== undefined ? name : 'Unknown Item';
    }
}
