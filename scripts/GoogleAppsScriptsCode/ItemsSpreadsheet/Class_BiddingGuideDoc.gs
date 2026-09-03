/**
 * Document Generator. Produces two separate documents:
 *   1. Cover page — bidder-number table + full-page auction image
 *   2. Inner pages — schedule of events + live auction item listings
 *
 * @param {string}             fileName
 * @param {AuctionItemManager} itemManager
 */
class BiddingGuideDoc extends DocService {
    constructor ( fileName, itemManager, folderID = null ) {
        super( fileName, folderID );
        this.itemManager = itemManager;

        this.myBidderNumberText = 'MY BIDDER NUMBER:';
        this.schedOfEventsText = 'Schedule of Events';
        this.eventTimes = [
            { time: '6:30 PM', text: 'Arrival & Silent Auction Begins' },
            { time: '8:00 PM', text: 'Classroom Art Silent Auction Closes' },
            { time: '8:30 PM', text: 'Black Table Silent Auction Closes' },
            { time: '9:00 PM', text: 'White Table Silent Auction Closes' },
            { time: '9:30 PM', text: 'Live Auction & Raffle Drawing' },
            { time: '10:15 PM', text: 'Checkout & After Party Dancing Begins' }
        ];

        this.firstEntry = 0;
        this.liveItemsForPrint = this.liveCategory + ' Auction Items';

        const doc = this.getDoc_();
        this.cachedBody = doc ? doc.getBody() : null;
        if ( !this.cachedBody ) throw new Error( `BiddingGuideDoc: failed to initialize body for "${ fileName }"` );
    }

    getFirstEntry_ () { return this.firstEntry; }
    incrementFirstEntry_ () { this.firstEntry++; }

    // ── Cover-page helpers ───────────────────────────────────────────────────
    writeAuctionImageToDoc_ () {
        this.cachedBody.insertParagraph( this.getLineCount_(), '' )
            .setFontSize( 11 )
            .addPositionedImage( this.getAuctionLogoBlob() )
            .setLayout( DocumentApp.PositionedLayout.BREAK_BOTH )
            .setTopOffset( 12.24 )
            .setLeftOffset( 16.56 )
            .setHeight( 816 )
            .setWidth( 580.8 );
        this.incrementLineCount_();
    }

    writeBidSheetTable_ () {
        const tableCells = Array.from( { length: 10 }, () => [ '', '' ] );
        const table = this.cachedBody.insertTable( this.getLineCount_(), tableCells );
        table.setColumnWidth( 0, 237.6 )
            .setBorderColor( this.auctionGray )
            .setBorderWidth( 1 )
            .setAttributes( this.bidSheetTableStyle );

        const headerRow = table.getRow( 0 );
        headerRow.getCell( 0 )
            .setBackgroundColor( this.auctionGray )
            .setForegroundColor( this.white )
            .setText( 'ITEM' );
        headerRow.getCell( 1 )
            .setBackgroundColor( this.auctionGray )
            .setForegroundColor( this.white )
            .setText( 'PRICE' );
        table.getRow( 1 )
            .getCell( 0 )
            .setBackgroundColor( this.white )
            .setForegroundColor( this.auctionGray );
        table.getRow( 1 )
            .getCell( 1 )
            .setBackgroundColor( this.white )
            .setForegroundColor( this.auctionGray );
        this.incrementLineCount_();
    }

    writeMyBidderNumber_ () {
        this.writeTextWithStyle_( this.myBidderNumberText, this.normalParagraph, this.horizontalLeft, this.bidderNumHeaderStyle );
        this.newPageBreak_();
    }

    writeBidSheetTableNameAndNumber_ () {
        this.writeBidSheetTable_();
        this.writeMyBidderNumber_();
        this.writeAuctionImageToDoc_();
    }

    // ── Inner-page helpers ───────────────────────────────────────────────────
    setupScheduleOfEventsPage_ () {
        this.writeTextWithStyle_( this.schedOfEventsText, this.heading1, this.horizontalCenter, this.scheduleOfEventsTitleStyle );
        this.eventTimes.forEach( event =>
            this.writeTextWithStyle_( `${ event.time }\n${ event.text }`,
                this.normalParagraph,
                this.horizontalCenter,
                this.scheduleOfEventsTextStyle
            )
        );
        this.newPageBreak_();
    }

    writeLiveAuctionCategoryHeader_ () {
        this.writeHeaderTextWithUnderlineStyle_( this.liveItemsForPrint, this.heading1, this.horizontalLeft, this.categoryStyle );
        this.incrementFirstEntry_();
    }

    loopThroughAllLiveAuctionItems_ () {
        // Uses getValidSortedItems() (not a raw index loop) so inactive/deleted
        // items are never printed, and items are shown in ID order - matching
        // every other document generator's behavior.
        const liveItems = this.itemManager.getValidSortedItems().filter( item => item.isLive() );

        for ( const item of liveItems ) {
            if ( this.getFirstEntry_() === 0 ) this.writeLiveAuctionCategoryHeader_();

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
    }

    // ── Public orchestrators ─────────────────────────────────────────────────
    generateCoverPage () {
        // this.giveUserHeadsUpAboutLoadingTime_();
        this.writeBidSheetTableNameAndNumber_();
        this.doc.saveAndClose();
    }

    generateInnerPages () {
        // this.giveUserHeadsUpAboutLoadingTime_();
        this.setupScheduleOfEventsPage_();
        this.loopThroughAllLiveAuctionItems_();
        this.doc.saveAndClose();
    }
}

function createNewBiddingGuideCoverPage () {
    new BiddingGuideDoc( 'Auction Bidding Guide Cover Page', new AuctionItemManager() ).generateCoverPage();
}
function createNewBiddingGuideInnerPages () {
    new BiddingGuideDoc( 'Auction Bidding Guide Inner Pages', new AuctionItemManager() ).generateInnerPages();
}