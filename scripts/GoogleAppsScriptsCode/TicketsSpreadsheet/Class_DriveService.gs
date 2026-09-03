/**
 * Service wrapper. Extends GlobalStyles so it inherits all style constants
 * and has access to `this.config` for Drive IDs.
 *
 * Provides lazy-loaded, cached access to each Drive resource referenced
 * in the _Settings tab. Resource validation is deferred to point-of-use
 * (TemplateManager throws if a resource is missing) rather than at
 * construction time.
 */
class DriveService extends GlobalStyles {
    constructor () {
        super();
    }

    /**
     * Safe, typed wrapper around DriveApp.
     * Returns null instead of throwing when an ID is missing or inaccessible.
     * @param {string} id    The Drive resource ID.
     * @param {string} type  'file' | 'folder'
     * @returns {GoogleAppsScript.Drive.File|GoogleAppsScript.Drive.Folder|null}
     */
    safeFetch_ ( id, type ) {
        if ( !id || id.toString().trim() === '' || id.toString().includes( 'PASTE' ) ) return null;
        try {
            if ( type === 'file' ) return DriveApp.getFileById( id );
            if ( type === 'folder' ) return DriveApp.getFolderById( id );
        } catch ( e ) {
            console.warn( `DriveService.safeFetch_: could not access ${ type } "${ id }". ${ e.message }` );
            return null;
        }
    }

    // ── Cached resource getters ──────────────────────────────────────────────
    getAuctionSoftwareDevFolder () {
        if ( !this._auctionFolder ) {
            this._auctionFolder = this.safeFetch_( this.config[ 'auctionDevFolderID' ], 'folder' );
        }
        return this._auctionFolder;
    }

    getAvery5264TemplateFile () {
        if ( !this._avery5264Template ) {
            this._avery5264Template = this.safeFetch_( this.config[ 'avery5264LabelTemplateID' ], 'file' );
        }
        return this._avery5264Template;
    }

    /**
     * If a valid folderID is provided, overrides getAuctionSoftwareDevFolder()
     * on this instance so all file-placement calls use it instead of _Settings.
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