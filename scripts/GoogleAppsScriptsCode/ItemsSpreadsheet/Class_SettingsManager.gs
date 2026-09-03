/**
 * Foundation class. Manages the UI workflow for reading and updating the
 * _Settings tab. Extends GlobalVariables so it can read `this.config` and
 * write back to the sheet by key.
 */
class SettingsManager extends GlobalVariables {
    constructor () {
        super();
        this.uiManager = new UIManager();
    }

    /**
     * Presents a numbered prompt menu so the user can pick which setting to
     * update, then delegates to runUpdateLogic().
     */
    startSettingsWorkflow () {
        const options = [
            { key: 'auctionLogoID', label: "The year's auction invitation image" },
            { key: 'auctionDevFolderID', label: "This year's auction folder" },
            { key: 'auctionTicketSheetsID', label: "The year's tickets sheet" },
            { key: 'avery8163LabelTemplateID', label: "The Avery 8163 Label template" },
            { key: 'liveAuctionBgImgID', label: "Live auction presentation background image" },
            { key: 'ornsLogoID', label: "The ORNS logo" }
        ];

        const optionsString = options.map( ( opt, i ) => `${ i + 1 }. ${ opt.label }` ).join( '\n' );

        const responseText = this.uiManager.promptOkCancel(
            'Which setting are you updating?',
            optionsString + '\n\nEnter the number (e.g., 1):'
        );

        if ( !responseText ) return;

        const choice = parseInt( responseText ) - 1;
        if ( options[ choice ] ) {
            this.runUpdateLogic( options[ choice ].key, options[ choice ].label );
        } else {
            this.uiManager.showAlert( 'Invalid Selection', 'Invalid selection. Please try again.' );
        }
    }

    /**
     * Prompts for a Drive URL, extracts the file/folder ID, and saves it.
     * @param {string} technicalKey  The key name in the _Settings sheet.
     * @param {string} humanLabel    Human-readable label shown in the prompt.
     */
    runUpdateLogic ( technicalKey, humanLabel ) {
        const urlResponse = this.uiManager.promptOkCancel(
            `Updating: ${ humanLabel }`,
            'Paste the Google Drive URL:'
        );
        if ( !urlResponse ) return;

        const descResponse = this.uiManager.promptOkCancel(
            'Location Description',
            'Where is this located? (e.g., 2027 Auction > Dan\'s Folder):'
        );
        if ( !descResponse ) return;

        const idMatch = urlResponse.match( /[-\w]{25,}/ );
        if ( !idMatch ) {
            this.uiManager.showAlert( 'Error', 'Invalid URL. No ID found.' );
            return;
        }

        this.saveToSettingsSheet_( technicalKey, idMatch[ 0 ], descResponse );
        this.uiManager.showAlert( 'Success', 'Success! Setting updated.' );
    }

    /**
     * Writes a key/value/description row back to the _Settings sheet.
     * Updates the row in-place if the key exists; appends a new row otherwise.
     */
    saveToSettingsSheet_ ( key, value, description ) {
        const sheet = this.activeSpreadSheet.getSheetByName( '_Settings' );
        const data = sheet.getRange( 'A:A' ).getValues();

        let rowIndex = -1;
        for ( let i = 0; i < data.length; i++ ) {
            if ( data[ i ][ 0 ].toString().trim() === key ) { rowIndex = i + 1; break; }
        }

        if ( rowIndex !== -1 ) {
            sheet.getRange( rowIndex, 2 ).setValue( value );
            sheet.getRange( rowIndex, 3 ).setValue( description );
        } else {
            sheet.appendRow( [ key, value, description ] );
        }
    }
}

function updateFileOrFolderLocations () { new SettingsManager().startSettingsWorkflow(); }