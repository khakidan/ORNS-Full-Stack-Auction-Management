/**
 * Utility manager. Extends DriveService so it can access the Avery template
 * file from Drive and the configured destination folder.
 *
 * Responsible for cloning template files (currently the Avery 8163 label
 * template) into the auction folder before any generator writes to them.
 */
class TemplateManager extends DriveService {
    constructor ( folderID = null ) {
        super();
        this._applyFolderOverride_( folderID ); // ← override before getAvery8163LabelDocCopy() runs
    }

    /**
     * Copies the Avery 8163 label template into the auction folder and returns
     * an open DocumentApp reference to the copy.
     * @param {string} [copyName='Labels For Newly Packaged Items']
     * @returns {GoogleAppsScript.Document.Document}
     */
    getAvery8163LabelDocCopy ( copyName = 'Labels For Newly Packaged Items' ) {
        const templateFile = this.getAvery8163TemplateFile();
        if ( !templateFile ) {
            throw new Error( 'TemplateManager: Avery 8163 template ID is missing in _Settings.' );
        }

        const destinationFolder = this.getAuctionSoftwareDevFolder();
        if ( !destinationFolder ) {
            throw new Error( 'TemplateManager: auction folder ID is missing in _Settings.' );
        }

        const copy = templateFile.makeCopy( copyName ).moveTo( destinationFolder );
        return DocumentApp.openById( copy.getId() );
    }
}