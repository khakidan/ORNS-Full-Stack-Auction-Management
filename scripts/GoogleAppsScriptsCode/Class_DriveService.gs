/**
 * Service wrapper. Extends GlobalStyles so it inherits all style constants.
 * Provides lazy-loaded, cached access to every Drive resource referenced
 * in the _Settings tab.
 */
class DriveService extends GlobalStyles {
    constructor () {
        super();
    }

    safeFetch_ ( id, type ) {
        if ( !id || id.toString().trim() === '' || id.toString().includes( 'PASTE' ) ) return null;
        try {
            if ( type === 'file' ) return DriveApp.getFileById( id );
            if ( type === 'folder' ) return DriveApp.getFolderById( id );
            if ( type === 'spreadsheet' ) return SpreadsheetApp.openById( id );
        } catch ( e ) {
            console.warn( `DriveService.safeFetch_: could not access ${ type } "${ id }". ${ e.message }` );
            return null;
        }
    }

    getOrnsLogoBlob () {
        if ( !this._ornsLogoBlob ) {
            const file = this.safeFetch_( this.config[ 'ornsLogoID' ], 'file' );
            this._ornsLogoBlob = file ? file.getBlob() : null;
        }
        return this._ornsLogoBlob;
    }

    getAuctionImportSheet () {
        if ( !this._importSheet ) {
            this._importSheet = this.safeFetch_( this.config[ 'auctionImportSheetID' ], 'spreadsheet' );
        }
        return this._importSheet;
    }

    getAuctionTicketsSheet () {
        if ( !this._ticketsSheet ) {
            this._ticketsSheet = this.safeFetch_( this.config[ 'auctionTicketSheetsID' ], 'spreadsheet' );
        }
        return this._ticketsSheet;
    }

    getReceiptFolder () {
        if ( !this._receiptFolder ) {
            this._receiptFolder = this.safeFetch_( this.config[ 'receiptFolderID' ], 'folder' );
        }
        return this._receiptFolder;
    }

    /**
     * If a valid folderID is provided, overrides getReceiptFolder() on this
     * instance so all file-placement calls use it instead of _Settings.
     * @param {string|null|undefined} folderID
     */
    _applyFolderOverride_ ( folderID ) {
        if ( !folderID || folderID.toString().trim() === '' || folderID.toString().includes( 'PASTE' ) ) return;
        try {
            const folder = DriveApp.getFolderById( folderID );
            this.getReceiptFolder = () => folder;
            console.log( 'DriveService: receipt folder override applied → ' + folderID );
        } catch ( e ) {
            console.error( 'DriveService: could not apply folder override for ID "' + folderID + '". ' + e.message );
        }
    }
}