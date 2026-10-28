/**
 * Service wrapper. Extends DriveService so it inherits all styles and
 * Drive resource access.
 *
 * Manages the full lifecycle of a Google Doc: creation, body access,
 * line-count tracking, file move to the receipt folder, and save/close.
 * All Document Generators extend this class.
 */
class DocService extends DriveService {
    constructor ( folderID = null ) {
        super();
        this.doc = null;
        this.docID = '';
        this.lineCount = 0;
        this._applyFolderOverride_( folderID ); // ← override before any convertToPdfAndMove_() call
    }

    // ── Doc / ID accessors ───────────────────────────────────────────────────
    getDoc_ () { return this.doc; }
    getDocID_ () { return this.docID; }

    /**
     * Creates a new Google Doc and stores the reference and ID.
     * @param {string} docName
     */
    setDoc_ ( docName ) {
        try {
            this.doc = DocumentApp.create( docName );
            this.docID = this.doc.getId();
        } catch ( e ) {
            console.error( `DocService.setDoc_: could not create "${ docName }". ${ e.message }` );
            throw new Error( `File Creation Failed: ${ e.message }` );
        }
    }

    /**
     * Returns the document body, with null-guard and error logging.
     */
    getDocBody_ () {
        if ( !this.doc ) {
            console.error( `DocService.getDocBody_: doc is not open (docID: ${ this.docID }).` );
            return null;
        }
        try {
            return this.doc.getBody();
        } catch ( e ) {
            console.error( `DocService.getDocBody_: failed for ID ${ this.docID }. ${ e.message }` );
            return null;
        }
    }

    // ── Line-count helpers ───────────────────────────────────────────────────
    incrementLineCount_ () { return ++this.lineCount; }

    newPageBreak_ () {
        this.doc.getBody().insertPageBreak( this.lineCount );
        return this.incrementLineCount_();
    }

    getLineCount_ () { return this.lineCount; }
    setLineCount_ ( count ) { this.lineCount = count; }

    // ── Save / move ──────────────────────────────────────────────────────────

    /**
     * Flushes all pending changes and closes the document.
     * Clears the reference so we never accidentally call methods on a closed doc.
     */
    saveAndClose_ () {
        if ( this.doc ) {
            this.doc.saveAndClose();
            this.doc = null;
        }
    }

    /**
     * Re-opens the document after a saveAndClose_() call during long batch runs.
     * Safe to call even if the doc is already open — does nothing in that case.
     * Use this instead of directly accessing doc.doc from outside the class.
     */
    reopenDoc_ () {
        if ( !this.doc && this.docID ) {
            this.doc = DocumentApp.openById( this.docID );
        }
    }

    /**
     * Moves this document to the configured receipt folder.
     * Uses this.docID internally — no parameter needed.
     * Retries up to 3 times to handle Drive propagation delays.
     */
    moveFileToReceiptFolder_ () {
        if ( !this.docID ) return;

        const destinationFolder = this.getReceiptFolder();
        if ( !destinationFolder ) {
            console.error( 'DocService: receipt folder ID is missing or invalid.' );
            return;
        }

        for ( let attempt = 0; attempt < 3; attempt++ ) {
            try {
                DriveApp.getFileById( this.docID ).moveTo( destinationFolder );
                return;
            } catch ( e ) {
                console.warn( `Move attempt ${ attempt + 1 } failed: ${ e.message }` );
                if ( attempt < 2 ) Utilities.sleep( 1500 );
            }
        }
        console.error( `DocService: failed to move file ${ this.docID } after 3 attempts.` );
    }

    /**
 * Converts the closed Google Doc to a PDF, saves it to the receipt folder,
 * and optionally trashes the original temporary Google Doc.
 * MUST be called after saveAndClose_().
 * @param {boolean} trashOriginal
 * @returns {string|null} The ID of the newly created PDF.
 */
    convertToPdfAndMove_ ( trashOriginal = true ) {
        if ( !this.docID ) return null;

        const destinationFolder = this.getReceiptFolder();
        if ( !destinationFolder ) {
            console.error( 'DocService: receipt folder ID is missing or invalid.' );
            return null;
        }

        const docFile = DriveApp.getFileById( this.docID );

        // Export the document as a PDF blob
        const pdfBlob = docFile.getAs( 'application/pdf' );

        // Append .pdf so the macOS app recognizes the file extension natively
        pdfBlob.setName( docFile.getName() + '.pdf' );

        let pdfFile = null;

        // Retry loop for Drive propagation
        for ( let attempt = 0; attempt < 3; attempt++ ) {
            try {
                pdfFile = destinationFolder.createFile( pdfBlob );
                break;
            } catch ( e ) {
                console.warn( `PDF creation attempt ${ attempt + 1 } failed: ${ e.message }` );
                if ( attempt < 2 ) Utilities.sleep( 1500 );
            }
        }

        if ( !pdfFile ) {
            console.error( `DocService: failed to create PDF for file ${ this.docID }.` );
            return null;
        }

        // Clean up the original Google Doc
        if ( trashOriginal ) {
            docFile.setTrashed( true );
        }

        return pdfFile.getId();
    }
}