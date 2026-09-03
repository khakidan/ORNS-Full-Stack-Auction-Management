/**
 * Document Generator. Produces the full auction catalog with a cover image
 * and per-category sections, one page break between each category.
 *
 * @param {string}             fileName    Document name (without year prefix).
 * @param {AuctionItemManager} itemManager Provides AuctionItem instances.
 */
class CatalogDoc extends DocService {
    constructor ( fileName, itemManager, folderID = null ) {
        super( fileName, folderID );
        this.itemManager = itemManager;

        this.category1 = '';
        this.category2 = '';
        this.currentAuctionItem = null;
        this.nextAuctionItem = null;
    }

    getCategory1_ () { return this.category1; }
    setCategory1_ ( cat ) { this.category1 = cat; }
    getCategory2_ () { return this.category2; }
    setCategory2_ ( cat ) { this.category2 = cat; }

    // ── Private write helpers ────────────────────────────────────────────────
    writeCatalogCoverPage_ () {
        const body = this.getDoc_().getBody();
        body.insertParagraph( this.getLineCount_(), '' )
            .setFontSize( 11 )
            .addPositionedImage( this.getAuctionLogoBlob() )
            .setLayout( DocumentApp.PositionedLayout.BREAK_BOTH )
            .setTopOffset( 12.24 )
            .setLeftOffset( 16.56 )
            .setHeight( 816 )
            .setWidth( 580.8 );
        this.incrementLineCount_();
        this.newPageBreak_();
    }

    writeNewCatalogCategoryName_ ( category ) {
        this.writeHeaderTextWithUnderlineStyle_(
            category, this.heading1, this.horizontalLeft, this.categoryStyle
        );
    }

    writeAuctionItemInfoToCatalog_ ( item ) {
        this.writeMultiLineTextWithStyle_(
            item.id, '\t' + item.name,
            this.normalParagraph, this.horizontalLeft,
            this.auctionItemIdNumStyle, this.auctionItemStyle
        );
        this.writeTextWithStyle_( item.description, this.normalParagraph, this.horizontalLeft, this.descriptionStyle );
        this.writeMultiLineTextWithStyle_(
            `Value: $${ item.value }${ this.tab2 }Opening Bid: $${ item.openingBid }${ this.hardReturn }`,
            `Donated By: ${ item.donatedBy }${ this.hardReturn }`,
            this.normalParagraph, this.horizontalLeft,
            this.originalValueStyle, this.donatedByStyle
        );
    }

    loopThroughAllAuctionItemsForCatalogDoc_ () {
        const items = this.itemManager.getValidSortedItems();
        const total = items.length;

        for ( let i = 0; i < total; i++ ) {
            const isLastItem = i === total - 1;

            this.currentAuctionItem = items[ i ];
            this.nextAuctionItem = isLastItem ? null : items[ i + 1 ];

            this.setCategory1_( this.currentAuctionItem.category );
            this.setCategory2_( this.nextAuctionItem ? this.nextAuctionItem.category : null );

            if ( i === 0 ) this.writeNewCatalogCategoryName_( this.getCategory1_() );

            this.writeAuctionItemInfoToCatalog_( this.currentAuctionItem );

            if ( !isLastItem && this.getCategory1_() !== this.getCategory2_() ) {
                this.setLineCount_( this.newPageBreak_() );
                this.writeNewCatalogCategoryName_( this.getCategory2_() );
            }
        }
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    generateCatalog () {
        this.writeCatalogCoverPage_();
        this.loopThroughAllAuctionItemsForCatalogDoc_();
        this.doc.saveAndClose();
    }
}

function createNewCatalog () {
    new CatalogDoc( 'Auction Catalog', new AuctionItemManager() ).generateCatalog();
}