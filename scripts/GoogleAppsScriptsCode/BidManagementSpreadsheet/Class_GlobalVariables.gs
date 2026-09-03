/**
 * Foundation class. Loads and caches the _Settings configuration via
 * PropertiesService so every subclass has access to `this.config`.
 * Also holds shared string constants and UI banding colors.
 */
class GlobalVariables {
    /**
     * @param {Object} [overrides] Optional dependency/config injection, used
     *   by unit tests to avoid touching the real active spreadsheet or its
     *   _Settings tab. Production call sites (`new GlobalVariables()`, or a
     *   subclass's `super()` with no args) never pass this.
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [overrides.activeSpreadSheet]
     *   Replaces `SpreadsheetApp.getActiveSpreadsheet()`.
     * @param {Object} [overrides.config]
     *   Replaces the real `_Settings` tab read entirely when given (skips
     *   touching `overrides.activeSpreadSheet`/the real one for it).
     */
    constructor ( overrides = {} ) {
        this.activeSpreadSheet = overrides.activeSpreadSheet || SpreadsheetApp.getActiveSpreadsheet();

        // ── Sheet name constants ─────────────────────────────────────────────
        this.bidManagementString = 'Bid-Management';
        this.bidNumbersString = 'Bidder-Numbers';
        this.auctionItemsString = 'Auction-Items';

        if ( overrides.config !== undefined ) {
            this.config = overrides.config;
        } else {
            // ── Load _Settings dynamically on every execution ────────────────────
            const requiredKeys = [
                'auctionImportSheetID',
                'auctionTicketSheetsID',
                'ornsLogoID',
                'receiptFolderID',
                'ticketPrice'
            ];

            let settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            if ( !settingsSheet ) {
                this.createEmptySettingsTab_( requiredKeys );
                settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            }

            this.config = {};
            settingsSheet.getDataRange().getValues().forEach( row => {
                if ( row[ 0 ] && row[ 0 ] !== 'Setting Key' ) {
                    this.config[ row[ 0 ] ] = row[ 1 ];
                }
            } );
        }

        this.currentYear = new Date().getFullYear();
    }

    createEmptySettingsTab_ ( keys ) {
        // Guard against calling UI in API context
        let ui = null;
        try { ui = SpreadsheetApp.getUi(); } catch ( e ) { }

        if ( ui ) {
            const strings = new UIStrings();
            ui.alert(
                strings.configRequiredTitle,
                strings.configRequiredMsg,
                ui.ButtonSet.OK
            );
        }

        const sheet = this.activeSpreadSheet.insertSheet( '_Settings' );
        sheet.getRange( 'A1:C1' )
            .setValues( [ [ 'Setting Key', 'ID Value', 'Location Description' ] ] )
            .setFontWeight( 'bold' );

        sheet.getRange( 2, 1, keys.length, 1 ).setValues( keys.map( k => [ k ] ) );
        sheet.setColumnWidth( 1, 200 )
            .setColumnWidth( 2, 350 )
            .setColumnWidth( 3, 350 );
        sheet.setFrozenRows( 1 );

        // Still throw the error to stop execution if config is missing
        throw new Error( "Configuration Required: Settings tab initialized. Please configure it." );
    }
}