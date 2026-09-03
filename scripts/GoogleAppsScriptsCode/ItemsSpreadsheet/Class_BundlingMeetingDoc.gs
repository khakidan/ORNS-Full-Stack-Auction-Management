/**
 * Document Generator. Produces a printable table listing every auction item
 * so the bundling team can annotate it by hand during their meeting.
 *
 * The interactive bundling workflow (prompts, sheet edits) lives in
 * BundlingWorkflowManager — this class only handles the printed document.
 *
 * @param {string}             fileName
 * @param {AuctionItemManager} itemManager
 */
class BundlingMeetingDoc extends DocService {
    constructor ( fileName, itemManager, folderID = null ) {
        super( fileName, folderID );
        this.itemManager = itemManager;
    }

    // ── Printable-doc helpers ────────────────────────────────────────────────

    writeBundlingInfoTable_ () {
        const tableCells = [
            [ 'Row', 'Item Name', 'Bundle with (row #):', 'Suggested Name' ],
            [ '', '', '', '' ]
        ];
        const body = this.getDoc_().getBody();
        const table = body.insertTable( 1, tableCells )
            .setColumnWidth( 0, 50 )
            .setBorderColor( this.black )
            .setBorderWidth( 1 )
            .setAttributes( this.packagingDocumentStyle );

        [ 0, 1, 2, 3 ].forEach( col => {
            table.getRow( 0 ).getCell( col )
                .setBackgroundColor( this.lightGray )
                .setForegroundColor( this.black )
                .setAttributes( this.packagingDocumentStyle );
            table.getRow( 1 ).getCell( col )
                .setBackgroundColor( this.white )
                .setForegroundColor( this.black )
                .setAttributes( this.packagingDocumentStyle );
        } );

        this.incrementLineCount_();
    }

    loopThroughAllAuctionItemsForBundlingDocument () {
        this.writeBundlingInfoTable_();
        const table = this.getDoc_().getBody().getTables()[ 0 ];
        const firstRow = table.getRow( 1 );
        const items = this.itemManager.getValidSortedItems();

        for ( let i = 0; i < items.length; i++ ) {
            const item = items[ i ];
            const displayRow = i + 2;

            if ( i === 0 ) {
                firstRow.getCell( 0 ).setText( displayRow );
                firstRow.getCell( 1 ).setText( item.name );
            } else {
                table.insertTableRow( i + 1 ).insertTableCell( 0 ).setText( displayRow );
                table.getRow( i + 1 ).insertTableCell( 1 ).setText( item.name );
                table.getRow( i + 1 ).insertTableCell( 2 ).setText( ' ' );
                table.getRow( i + 1 ).insertTableCell( 3 ).setText( ' ' );
            }
        }
    }

    // ── Public orchestrator ──────────────────────────────────────────────────

    generateBundlingDoc () {
        this.loopThroughAllAuctionItemsForBundlingDocument();
        this.doc.saveAndClose();
    }
}

function printAuctionItemsForBundling () {
    new BundlingMeetingDoc( 'Items Up For Auction', new AuctionItemManager() ).generateBundlingDoc();
}