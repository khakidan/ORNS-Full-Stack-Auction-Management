/**
 * Utility manager. Extends DriveService so it can access both the Avery
 * 5264 template file and the destination folder from Drive.
 *
 * Responsible for cloning the template into the auction folder before the
 * Document Generator writes to it. Throws descriptive errors when either
 * Drive resource is missing, deferring validation to point-of-use rather
 * than at construction time.
 */
class TemplateManager extends DriveService {
    constructor ( folderID = null ) {
        super();
        this._applyFolderOverride_( folderID ); // ← override before getAvery5264LabelDocCopy() runs
    }

    /**
     * Copies the Avery 5264 label template into the auction folder and returns
     * an open DocumentApp reference to the copy.
     * @param {string} copyName  The name for the copy (year prefix is added automatically).
     * @returns {GoogleAppsScript.Document.Document}
     */
    getAvery5264LabelDocCopy ( copyName ) {
        const templateFile = this.getAvery5264TemplateFile();
        if ( !templateFile ) {
            throw new Error( 'TemplateManager: Avery 5264 template ID is missing or invalid in _Settings.' );
        }

        const destinationFolder = this.getAuctionSoftwareDevFolder();
        if ( !destinationFolder ) {
            throw new Error( 'TemplateManager: auction folder ID is missing or invalid in _Settings.' );
        }

        const copy = templateFile.makeCopy( `${ this.currentYear } ${ copyName }`, destinationFolder );
        return DocumentApp.openById( copy.getId() );
    }
}