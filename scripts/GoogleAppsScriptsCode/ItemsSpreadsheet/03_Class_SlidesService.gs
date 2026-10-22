/**
 * Service wrapper. Extends DriveService so it inherits all styles and
 * Drive resource access.
 *
 * Handles the full lifecycle of a Google Slides presentation:
 *   - creation and folder placement
 *   - slide-count bookkeeping
 *   - SlidesApp alignment constants used by LiveAuctionSlides
 */
class SlidesService extends DriveService {
    constructor ( folderID = null ) {
        super();

        this._applyFolderOverride_( folderID ); // ← set before createFileForLiveAuctionPresentation_() runs

        // SlidesApp alignment constants
        this.ALIGN_CENTER = SlidesApp.AlignmentPosition.CENTER;
        this.ALIGN_PARAGRAPH_CENTER = SlidesApp.ParagraphAlignment.CENTER;
        this.ALIGN_CONTENT_MIDDLE = SlidesApp.ContentAlignment.MIDDLE;
        this.TEXT_BOX = SlidesApp.ShapeType.TEXT_BOX;

        this.slides = null;
        this.slidesFileID = null;
        this.slideCount = 0;
    }

    // ── Accessors ────────────────────────────────────────────────────────────
    getSlidesFile_ () { return this.slides; }
    getSlidesFileID_ () { return this.slidesFileID; }
    getSlideCount () { return this.slideCount; }
    incrementSlideCount_ () { this.slideCount++; }

    // ── File creation & placement ────────────────────────────────────────────
    /**
     * Creates the presentation, stores a reference and its ID, then moves it
     * to the configured auction folder.
     */
    createFileForLiveAuctionPresentation_ () {
        this.slides = SlidesApp.create( `${ this.currentYear } Live Auction` );
        this.slidesFileID = this.slides.getId();
        this.moveFileToAuctionFolder( this.slidesFileID );
    }
}