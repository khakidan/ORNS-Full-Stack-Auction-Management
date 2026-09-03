/**
 * Service wrapper. Extends GlobalStyles (and therefore GlobalVariables) so
 * it has access to `this.config` for Drive IDs.
 *
 * Provides lazy-loaded, cached access to every Drive resource referenced in
 * the _Settings tab. All resource getters follow the same pattern:
 *   - check the private cache first
 *   - call safeFetch_ to access the Drive API
 *   - return null gracefully if the ID is missing or invalid
 */
class DriveService extends GlobalStyles {
    constructor () {
        super();
    }

    /**
     * Safe, typed wrapper around DriveApp / SpreadsheetApp.
     * Returns null instead of throwing when an ID is missing or inaccessible.
     * @param {string} id    The Drive resource ID.
     * @param {string} type  'file' | 'folder' | 'spreadsheet'
     * @returns {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder|GoogleAppsScript.Spreadsheet.Spreadsheet|null}
     */
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

    // ── Cached resource getters ──────────────────────────────────────────────
    getAuctionLogoBlob () {
        if ( !this._auctionLogoBlob ) {
            const file = this.safeFetch_( this.config[ 'auctionLogoID' ], 'file' );
            this._auctionLogoBlob = file ? file.getBlob() : null;
        }
        return this._auctionLogoBlob;
    }

    getAuctionSoftwareDevFolder () {
        if ( !this._auctionFolder ) {
            this._auctionFolder = this.safeFetch_( this.config[ 'auctionDevFolderID' ], 'folder' );
        }
        return this._auctionFolder;
    }

    getAuctionTicketsSheet () {
        if ( !this._auctionTicketSheets ) {
            this._auctionTicketSheets = this.safeFetch_( this.config[ 'auctionTicketSheetsID' ], 'spreadsheet' );
        }
        return this._auctionTicketSheets;
    }

    getLiveAuctionBgImgBlob () {
        if ( !this._liveAuctionBgImg ) {
            const file = this.safeFetch_( this.config[ 'liveAuctionBgImgID' ], 'file' );
            this._liveAuctionBgImg = file ? file.getBlob() : null;
        }
        return this._liveAuctionBgImg;
    }

    getAvery8163TemplateFile () {
        if ( !this._averyTemplate ) {
            this._averyTemplate = this.safeFetch_( this.config[ 'avery8163LabelTemplateID' ], 'file' );
        }
        return this._averyTemplate;
    }

    getOrnsLogoBlob () {
        if ( !this._ornsLogoBlob ) {
            const file = this.safeFetch_( this.config[ 'ornsLogoID' ], 'file' );
            this._ornsLogoBlob = file ? file.getBlob() : null;
        }
        return this._ornsLogoBlob;
    }

    /**
     * Moves any Drive file to the configured auction folder.
     * Retries up to 3 times to handle Drive propagation delays.
     * @param {string} fileID    The ID of the file to move.
     */
    moveFileToAuctionFolder ( fileID ) {
        if ( !fileID ) return;

        const destinationFolder = this.getAuctionSoftwareDevFolder();
        if ( !destinationFolder ) {
            console.error( 'DriveService: auction folder ID is missing or invalid in _Settings.' );
            return;
        }

        for ( let attempt = 0; attempt < 3; attempt++ ) {
            try {
                DriveApp.getFileById( fileID ).moveTo( destinationFolder );
                return;
            } catch ( e ) {
                console.warn( `Move attempt ${ attempt + 1 } failed: ${ e.message }` );
                if ( attempt < 2 ) Utilities.sleep( 1500 );
            }
        }
    }

    /**
     * If a valid folderID is provided, overrides getAuctionSoftwareDevFolder()
     * on this instance so all file-placement calls use it instead of _Settings.
     * Called by DocService, SlidesService, and TemplateManager constructors.
     * @param {string|null|undefined} folderID
     */
    _applyFolderOverride_ ( folderID ) {
        if ( !folderID || folderID.toString().trim() === '' || folderID.toString().includes( 'PASTE' ) ) return;
        try {
            const folder = DriveApp.getFolderById( folderID );
            this.getAuctionSoftwareDevFolder = () => folder;
            console.log( 'DriveService: folder override applied → ' + folderID );
        } catch ( e ) {
            console.error( 'DriveService: could not apply folder override for ID "' + folderID + '". ' + e.message );
        }
    }
}