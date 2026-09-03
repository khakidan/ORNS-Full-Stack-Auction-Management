/**
 * Document Generator. Produces half-page (A5) bid sheets, one per item,
 * skipping Live and Movie Night items.
 *
 * @param {string}             fileName
 * @param {AuctionItemManager} itemManager
 */
class BidSheetDoc extends DocService {
    constructor ( fileName, itemManager, folderID = null ) {
        super( fileName, folderID );
        this.itemManager = itemManager;

        this.valueLabel = `${ this.tab7 }Value: $`;
        this.minRaiseLabel = 'MINIMUM RAISE: $';
        this.bidderNumLabel = 'Bidder #';
        this.bidLabel = 'Bid';
        this.firstBidLabel = '← [First Bid] $';
    }

    // ── Table helpers ────────────────────────────────────────────────────────
    buildTableCells_ ( openingBid ) {
        return [
            [ this.bidderNumLabel, this.bidLabel ],
            [ '', this.firstBidLabel + openingBid ],
            ...Array.from( { length: 9 }, () => [ '', '' ] )
        ];
    }

    writeBiddingSheetTable_ ( openingBid ) {
        const cells = this.buildTableCells_( openingBid );
        const body = this.getDoc_().getBody();
        const table = body.insertTable( this.getLineCount_(), cells )
            .setColumnWidth( 0, 216 )
            .setBorderColor( this.auctionGray )
            .setBorderWidth( 1 )
            .setAttributes( this.bidSheetTableStyle );

        const headerRow = table.getRow( 0 );
        headerRow.getCell( 0 )
            .setBackgroundColor( this.auctionGray )
            .setForegroundColor( this.white )
            .setAttributes( this.bidSheetTableHeaderStyle );
        headerRow.getCell( 1 )
            .setBackgroundColor( this.auctionGray )
            .setForegroundColor( this.white )
            .setAttributes( this.bidSheetTableHeaderStyle );
        table.getRow( 1 ).getCell( 0 )
            .setBackgroundColor( this.white )
            .setForegroundColor( this.auctionGray )
            .setAttributes( this.bidSheetTableHeaderStyle );

        this.incrementLineCount_();
    }

    // ── Item-write helper ────────────────────────────────────────────────────
    writeBidSheetItem_ ( item, isLastItem ) {
        this.writeMultiLineTextWithStyle_(
            item.id, this.valueLabel + item.getDisplayValue(),
            this.normalParagraph, this.horizontalCenter,
            this.bidSheetItemStyle, this.bidSheetItemStyle
        );
        this.writeTextWithStyle_( item.name, this.heading1, this.horizontalCenter, this.bidSheetHeaderStyle );
        this.writeTextWithStyle_( item.description, this.normalParagraph, this.horizontalLeft, this.bidSheetDescStyle );
        this.writeTextWithStyle_( this.minRaiseLabel + item.getDisplayMinRaise(),
            this.normalParagraph,
            this.horizontalCenter,
            this.bidSheetMinRaiseStyle
        );

        this.writeBiddingSheetTable_( item.getDisplayOpeningBid() );

        if ( !isLastItem ) this.setLineCount_( this.newPageBreak_() );
    }

    // ── Loop ─────────────────────────────────────────────────────────────────
    loopThroughAllAuctionItems_ () {
        const printableItems = this.itemManager.getValidSortedItems().filter( function ( item ) {
            return item.category !== 'Live' && item.category !== 'Movie Night';
        } );

        for ( let i = 0; i < printableItems.length; i++ ) {
            this.writeBidSheetItem_( printableItems[ i ], i === printableItems.length - 1 );
        }
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    generateBidSheets () {
        this.setHalfPageDimensions_();
        this.loopThroughAllAuctionItems_();
        this.doc.saveAndClose();
    }
}

function createBidSheets () {
    new BidSheetDoc( 'Bid Sheets', new AuctionItemManager() ).generateBidSheets();
}