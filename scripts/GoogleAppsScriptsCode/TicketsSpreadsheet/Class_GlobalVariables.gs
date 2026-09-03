/**
 * Foundation class. Holds core business constants and loads the _Settings
 * configuration so every subclass has access to `this.config`.
 */
class GlobalVariables {
    constructor () {
        this.activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
        this.currentYear = new Date().getFullYear();

        // Sheet name constants
        this.staffTicketsString = 'staff tickets';
        this.ticketsString = 'tickets';
        this.sponsorString = 'sponsor tickets';

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

    /**
     * Creates the _Settings tab with the given keys when it is missing.
     * Throws after creation so the user knows to fill it out before re-running.
     * @param {string[]} keys
     */
    createEmptySettingsTab_ ( keys ) {
        SpreadsheetApp.getUi().alert(
            'Configuration Error',
            'The "_Settings" tab was missing and has been created.\n' +
            'Please run "Set File & Folder Locations" before continuing.',
            SpreadsheetApp.getUi().ButtonSet.OK
        );

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