/**
 * The settings the web app passed to this run (Node's Config: logo, For
 * Print folder). Set by the api* bridge functions (useRunSettings_) before
 * anything is constructed; each Apps Script execution starts with a fresh
 * global scope, so one run's settings never reach another.
 */
var RUN_SETTINGS_ = {};

/** @param {Object|null|undefined} settings e.g. { ornsLogoID, auctionDevFolderID } */
function useRunSettings_ ( settings ) {
    RUN_SETTINGS_ = settings && typeof settings === 'object' ? settings : {};
}

/**
 * Foundation class. Holds core business constants and loads the _Settings
 * configuration so every subclass has access to `this.config`. _Settings
 * keeps only what the app's Config doesn't have (label template, auction
 * logo, slideshow background); the run's settings from the web app are
 * laid over it and win, so a stale copy there is never used (ROADMAP B11).
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
        this.bidNumbersString = "Bidder-Numbers";
        this.donatedByCharLimit = 32;
        this.currentYear = new Date().getFullYear();
        this.liveCategory = "Live";

        // Whitespace / formatting helpers
        this.tab2 = "\t\t";
        this.tab4 = "\t\t\t\t";
        this.tab6 = "\t\t\t\t\t\t";
        this.tab7 = "\t\t\t\t\t\t\t";
        this.hardReturn = "\n";
        this.hardReturn2 = "\n\n";

        // Blank auction-item template (used by some generators for safety)
        this.auctionItem = {
            id: "", category: "", name: "", description: "", value: "",
            donatedBy: "", minRaise: "", openingBid: "", grouped: "", phyOrCert: ""
        };

        if ( overrides.config !== undefined ) {
            this.config = overrides.config;
        } else {
            // ── Load _Settings ──────────────────────────────────────────────────
            const requiredKeys = [
                'auctionLogoID',
                'auctionDevFolderID',
                'auctionTicketSheetsID',
                'avery8163LabelTemplateID',
                'liveAuctionBgImgID',
                'ornsLogoID'
            ];

            let settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            if ( !settingsSheet ) {
                // The tab is created here (rather than in a dedicated settings
                // manager) so construction never leaves a half-initialized object.
                this.createEmptySettingsTab_( requiredKeys );
                settingsSheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
            }

            this.config = {};
            settingsSheet.getDataRange().getValues()
                .forEach( row => { this.config[ row[ 0 ] ] = row[ 1 ]; } );
            Object.keys( RUN_SETTINGS_ ).forEach( key => {
                if ( RUN_SETTINGS_[ key ] ) this.config[ key ] = RUN_SETTINGS_[ key ];
            } );
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