/**
 * Foundation class. Manages the UI workflow for reading and updating the
 * _Settings tab. Extends GlobalVariables so it can read `this.config`.
 * Clearing the PropertiesService cache on every write keeps the cached
 * config from going stale between runs.
 */
class SettingsManager extends GlobalVariables {
    constructor () {
        super();
        this.uiManager = new UIManager();
    }

    /**
     * Presents a numbered prompt menu so the user can pick which setting to update.
     */
    startSettingsWorkflow () {
        const options = [
            { key: 'auctionImportSheetID', label: "This year's auction import sheet" },
            { key: 'auctionTicketSheetsID', label: "The year's tickets sheet" },
            { key: 'ornsLogoID', label: 'The ORNS logo' },
            { key: 'receiptFolderID', label: "The year's receipts folder" }
        ];

        const optionsString = options.map( ( opt, i ) => `${ i + 1 }. ${ opt.label }` ).join( '\n' );
        const s = this.uiManager.strings;

        while ( true ) {
            const selectionText = this.uiManager.promptOkCancel(
                s.settingsWorkflowTitle,
                optionsString + s.settingsWorkflowPrompt
            );

            if ( selectionText === null ) return;

            const choice = parseInt( selectionText ) - 1;
            if ( options[ choice ] ) {
                this.runUpdateLogic( options[ choice ].key, options[ choice ].label );
                return;
            }

            this.uiManager.showAlert(
                s.invalidSelectionTitle,
                s.invalidSelectionMsg( selectionText, options.length )
            );
        }
    }

    /**
     * Dedicated workflow for updating the walk-in ticket price.
     */
    updateTicketPrice () {
        const currentPrice = this.config[ 'ticketPrice' ] || '35';
        const s = this.uiManager.strings;

        while ( true ) {
            const newPriceText = this.uiManager.promptOkCancel(
                s.ticketPriceTitle,
                s.ticketPricePrompt( currentPrice )
            );

            if ( newPriceText === null ) return;

            const newPrice = newPriceText.replace( /[^0-9.]/g, '' );
            if ( newPrice === '' || isNaN( parseFloat( newPrice ) ) ) {
                this.uiManager.showAlert( s.invalidPriceTitle, s.invalidPriceMsg );
            } else {
                this.saveToSettingsSheet_( 'ticketPrice', newPrice, 'Standard Walk-In Ticket Price' );
                // Bug fix: was showAlert(this.uiStrings.ticketPriceSuccess(newPrice)) — 1 argument, missing title
                this.uiManager.showAlert( s.successTitle, s.ticketPriceSuccessMsg( newPrice ) );
                return;
            }
        }
    }

    /**
     * Prompts for a Drive URL, extracts the file/folder ID, and saves it.
     * @param {string} technicalKey
     * @param {string} humanLabel
     */
    runUpdateLogic ( technicalKey, humanLabel ) {
        const s = this.uiManager.strings;
        let extractedId = '';

        while ( true ) {
            // Bug fix: was this.uiManager.updateDriveTitle(humanLabel) — wrong object
            const url = this.uiManager.promptOkCancel(
                s.updateDriveTitle( humanLabel ),
                s.updateDrivePrompt
            );

            if ( url === null ) return;

            const idMatch = url.match( /[-\w]{25,}/ );
            if ( idMatch ) {
                extractedId = idMatch[ 0 ];
                break;
            }

            // Bug fix: was this.uiManager.invalidDriveUrlTitle — wrong object
            this.uiManager.showAlert( s.invalidDriveUrlTitle, s.invalidDriveUrlMsg );
        }

        const description = this.uiManager.promptOkCancel(
            s.locationDescTitle,
            s.locationDescPrompt
        );
        if ( description === null ) return;

        this.saveToSettingsSheet_( technicalKey, extractedId, description );
        // Bug fix: was this.uiManager.successTitle, this.uiManager.settingUpdateSuccess — wrong object
        this.uiManager.showAlert( s.successTitle, s.settingUpdateSuccessMsg );
    }

    /**
     * Writes a key/value/description row back to the _Settings sheet and
     * clears the PropertiesService cache so the next run fetches fresh values.
     */
    saveToSettingsSheet_ ( key, value, description ) {
        const sheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
        const data = sheet.getRange( 'A:A' ).getValues();
        let rowIndex = -1;

        for ( let i = 0; i < data.length; i++ ) {
            if ( data[ i ][ 0 ].toString().trim() === key ) { rowIndex = i + 1; break; }
        }

        if ( rowIndex !== -1 ) {
            sheet.getRange( rowIndex, 2, 1, 2 ).setValues( [ [ value, description ] ] );
        } else {
            sheet.appendRow( [ key, value, description ] );
        }

        PropertiesService.getDocumentProperties().deleteProperty( 'auctionConfig' );
    }
}

function updateFileOrFolderLocations () { new SettingsManager().startSettingsWorkflow(); }
function updateTicketPriceWorkflow () { new SettingsManager().updateTicketPrice(); }