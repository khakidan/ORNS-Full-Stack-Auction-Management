/**
 * Service wrapper. Extends DriveService so it inherits all styles and
 * Drive resource access.
 *
 * Handles the full lifecycle of a Google Doc:
 *   - creation (named + year-prefixed)
 *   - placement in the auction folder (with retry logic)
 *   - line-count bookkeeping used by all write methods
 *   - shared primitive write methods consumed by Document Generators
 */
class DocService extends DriveService {
    constructor ( fileName, folderID = null ) {
        super();
        this.doc = null;
        this.docID = '';
        this.lineCount = 0;

        if ( fileName ) {
            this._setDoc( fileName );
            this._setDocID();
            this._applyFolderOverride_( folderID ); // ← override BEFORE the move
            this.moveFileToAuctionFolder( this.docID );
        }
    }

    // ── Doc / ID accessors ───────────────────────────────────────────────────
    getDoc_ () { return this.doc; }
    _setDoc ( name ) { this.doc = DocumentApp.create( `${ this.currentYear } ${ name }` ); }
    getDocID_ () { return this.docID; }
    _setDocID () { this.docID = this.doc.getId(); }

    // ── Line-count helpers ───────────────────────────────────────────────────
    getLineCount_ () { return this.lineCount; }
    setLineCount_ ( count ) { this.lineCount = count; }
    incrementLineCount_ () { this.lineCount++; return this.lineCount; }

    newPageBreak_ () {
        this.doc.getBody().insertPageBreak( this.lineCount );
        return this.incrementLineCount_();
    }

    // ── Document layout ──────────────────────────────────────────────────────
    setHalfPageDimensions_ () {
        this.doc.getBody()
            .setPageHeight( 576 )
            .setPageWidth( 396 )
            .setMarginTop( 28.8 )
            .setMarginBottom( 28.8 )
            .setMarginLeft( 36 )
            .setMarginRight( 36 );
    }

    // ── Shared write primitives (used by all Document Generators) ────────────
    writeTextWithStyle_ ( text, heading, alignment, style ) {
        this.getDoc_().getBody()
            .insertParagraph( this.getLineCount_(), text )
            .setHeading( heading )
            .setAlignment( alignment )
            .setAttributes( style );
        this.incrementLineCount_();
    }

    writeMultiLineTextWithStyle_ ( text1, text2, heading, alignment, style1, style2 ) {
        this.getDoc_().getBody()
            .insertParagraph( this.getLineCount_(), text1 )
            .setHeading( heading )
            .setAlignment( alignment )
            .setAttributes( style1 )
            .appendText( text2 )
            .setAttributes( style2 );
        this.incrementLineCount_();
    }

    writeHeaderTextWithUnderlineStyle_ ( text, heading, alignment, style ) {
        this.getDoc_().getBody()
            .insertParagraph( this.getLineCount_(), text )
            .setHeading( heading )
            .setAlignment( alignment )
            .setAttributes( style )
            .appendHorizontalRule();
        return this.incrementLineCount_();
    }
}