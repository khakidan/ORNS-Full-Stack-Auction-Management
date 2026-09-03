/**
 * Document Generator. Extends DocService and produces the bidder-number
 * label document by copying the Avery 5264 template (via TemplateManager)
 * and populating each label cell with a bidder name and number.
 *
 * The Avery 5264 template contains a 3×3 table per page (6 usable label
 * cells — columns 0 and 2, column 1 is a narrow gutter). Every 6 bidders
 * a new page break and table copy are appended.
 *
 * @param {Bidder[]} bidders  Already-fetched, already-validated bidder array
 *   (see BidderManager#getAllBidders). Fetching happens BEFORE this class is
 *   constructed so a failed/unmatched lookup never leaves a wasted, empty
 *   template copy behind in Drive.
 */
class BidderLabelsDoc extends DocService {
    constructor ( bidders, folderID = null ) {
        super();
        this.bidders = bidders;

        // Pass folderID so TemplateManager places the copy in the correct folder
        const templateManager = new TemplateManager( folderID );
        this.doc = templateManager.getAvery5264LabelDocCopy( 'Bid Numbers' );
        this.docID = this.doc.getId();
    }

    // ── Cell writer ──────────────────────────────────────────────────────────
    /**
     * Writes a bidder's name and number into a single label cell.
     * Clears any existing content, adds a buffer paragraph, then the name
     * (small) and number (large), and vertically centers the cell.
     * @param {GoogleAppsScript.Document.TableCell} cell
     * @param {Bidder} bidder
     */
    writeToCell_ ( cell, bidder ) {
        cell.clear();

        // Buffer paragraph (visual top padding)
        cell.appendParagraph( '' );

        // Bidder name (small)
        cell.appendParagraph( bidder.getDisplayName() )
            .setHeading( this.normalParagraph )
            .setAlignment( this.horizontalCenter )
            .setAttributes( this.bidNumNameStyle );

        // Bidder number (large)
        cell.appendParagraph( bidder.getNumber() )
            .setHeading( this.heading1 )
            .setAlignment( this.horizontalCenter )
            .setAttributes( this.bidNumStyle );

        cell.setVerticalAlignment( this.verticalCenter );
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    /**
     * Iterates over all bidders, fills label cells in the template table,
     * and appends new page-break + table copies every 6 bidders.
     */
    generateBidderLabels () {
        const body = this.getBody_();
        const bidders = this.bidders;

        const tables = body.getTables();
        if ( tables.length === 0 ) return;

        const firstTableCopy = tables[ 0 ].copy();
        let currentTable = tables[ 0 ];

        for ( let i = 0; i < bidders.length; i++ ) {
            // Start a new page + fresh table every 6 labels
            if ( i > 0 && i % 6 === 0 ) {
                body.appendPageBreak();
                currentTable = body.appendTable( firstTableCopy.copy() );
            }

            // Map flat index to row/col within the 3-row × 3-col table
            // (col 1 is a narrow gutter — labels go in cols 0 and 2)
            const j = i % 6;
            const rowIdx = Math.floor( j / 2 );
            const colIdx = ( j % 2 === 0 ) ? 0 : 2;

            const cell = currentTable.getRow( rowIdx ).getCell( colIdx );
            this.writeToCell_( cell, bidders[ i ] );
        }

        this.doc.saveAndClose();
    }
}