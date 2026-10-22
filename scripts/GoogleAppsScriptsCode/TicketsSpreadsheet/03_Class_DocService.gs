/**
 * Service wrapper. Extends DriveService so it inherits all styles and
 * Drive resource access.
 *
 * Holds the open document reference and ID set by BidderLabelsDoc after
 * TemplateManager creates the working copy. Provides shared accessors
 * used throughout the Document Generator layer.
 */
class DocService extends DriveService {
    constructor () {
        super();
        this.doc = null;
        this.docID = '';
    }

    getDoc_ () { return this.doc; }
    getDocID_ () { return this.docID; }
    getBody_ () { return this.getDoc_().getBody(); }
}