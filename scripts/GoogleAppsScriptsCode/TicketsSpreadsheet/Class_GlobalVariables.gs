/**
 * Foundation class. Holds core business constants and loads the _Settings
 * configuration so every subclass has access to `this.config`.
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
        this.currentYear = new Date().getFullYear();

        // Sheet name constants
        this.staffTicketsString = 'staff tickets';
        this.ticketsString = 'tickets';
        this.sponsorString = 'sponsor tickets';

        if ( overrides.config !== undefined ) {
            this.config = overrides.config;
        } else {
            // ── Load _Settings ──────────────────────────────────────────────────
            const requiredKeys = [
                'auctionDevFolderID',
                'avery5264LabelTemplateID'
            ];

            let settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            if ( !settingsSheet ) {
                this.createEmptySettingsTab_( requiredKeys );
                settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            }

            this.config = {};
            settingsSheet.getDataRange().getValues()
                .forEach( row => { this.config[ row[ 0 ] ] = row[ 1 ]; } );
        }
    }

    /**
     * Creates the _Settings tab with the given keys when it is missing.
     * Throws after creation so the user knows to fill it out before re-running.
     * @param {string[]} keys
     */
    createEmptySettingsTab_ ( keys ) {
        // Guard against calling UI in API context (no UI when this runs
        // because the web app called an api* bridge function).
        let ui = null;
        try { ui = SpreadsheetApp.getUi(); } catch ( e ) { }

        if ( ui ) {
            ui.alert(
                'Configuration Error',
                'The "_Settings" tab was missing and has been created.\n' +
                'Please run "Set File & Folder Locations" before continuing.',
                ui.ButtonSet.OK
            );
        }

        const sheet = this.activeSpreadSheet.insertSheet( '_Settings' );

        sheet.getRange( 'A1:C1' )
            .setValues( [ [ 'Setting Key', 'ID Value', 'Where It Points To' ] ] )
            .setFontWeight( 'bold' );

        sheet.getRange( 2, 1, keys.length, 1 ).setValues( keys.map( k => [ k ] ) );

        sheet.setColumnWidth( 1, 200 )
            .setColumnWidth( 2, 350 )
            .setColumnWidth( 3, 350 );
        sheet.setFrozenRows( 1 );

        throw new Error( 'Missing _Settings configuration. Tab created — please fill it out.' );
    }
}