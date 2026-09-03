/**
 * Document Generator. Extends SlidesService to produce the full live-auction
 * Google Slides presentation: title slide, disclaimer, one slide per Live item,
 * and the Open Appeal paddle-raise section.
 *
 * @param {AuctionItemManager} itemManager
 */
class LiveAuctionSlides extends SlidesService {
    constructor ( itemManager, folderID = null ) {
        super( folderID ); // passes to SlidesService, which applies the override
        this.itemManager = itemManager;

        this.OPEN_PADDLE_DESCRIPTION =
            'Your support of ORNS makes a difference! All of your contributions help update ' +
            'the school facilities and ensure we have fun, engaging materials for the students.' +
            this.hardReturn2 +
            "If you haven't found the perfect item to bid on tonight, but still want to make " +
            'a lasting impact at ORNS, here\'s your chance!';
        this.DISCLAIMER_TEXT = 'Please note: Complete Details & restrictions in bidding guide';
        this.DONATED_BY_TEXT = 'Donated By: ';
        this.ITEM_NUMBER_TEXT = this.hardReturn + 'Item #: ';
        this.VALUE_TEXT = this.hardReturn + 'Value: $';

        this.slidePosition = { left: 36, top: 21.6, width: 648, height: 144 };
    }

    // ── Slide writers ────────────────────────────────────────────────────────
    writeTitleSlide_ () {
        const file = this.getSlidesFile_();
        file.insertSlide( this.getSlideCount() )
            .insertImage( this.getAuctionLogoBlob() )
            .alignOnPage( this.ALIGN_CENTER );

        file.getSlides()[ 0 ]
            .insertShape( this.TEXT_BOX, 224.64, 281.52, 275.04, 58.32 )
            .getText()
            .setText( 'Live Auction' )
            .getTextStyle()
            .setFontSize( 36 )
            .setFontFamilyAndWeight( this.windsongFont, 400 )
            .setForegroundColor( this.auctionGray );

        file.getSlides()[ 0 ]
            .getShapes()[ 0 ]
            .getText()
            .getParagraphStyle()
            .setParagraphAlignment( this.ALIGN_PARAGRAPH_CENTER );

        this.incrementSlideCount_();
    }

    removeInitialSlide_ () {
        this.getSlidesFile_().getSlides()[ 1 ].remove();
    }

    writeDisclaimerSlide_ () {
        const file = this.getSlidesFile_();
        file.insertSlide( this.getSlideCount() )
            .insertShape( this.TEXT_BOX, 178.56, 103.68, 363.6, 198 )
            .getText()
            .setText( this.DISCLAIMER_TEXT )
            .getTextStyle()
            .setFontSize( 36 )
            .setFontFamilyAndWeight( this.playfairDisplayFont, 400 );

        file.getSlides()[ this.getSlideCount() ]
            .getShapes()[ 0 ]
            .getText()
            .getParagraphStyle()
            .setParagraphAlignment( this.ALIGN_PARAGRAPH_CENTER );

        this.incrementSlideCount_();
    }

    writeLiveAuctionItems_ () {
        // Uses getValidSortedItems() (not a raw index loop) so inactive/deleted
        // items never appear on stage, and items are shown in ID order -
        // matching every other document generator's behavior.
        const liveItems = this.itemManager.getValidSortedItems().filter( item => item.isLive() );

        for ( const item of liveItems ) {
            const file = this.getSlidesFile_();
            file.appendSlide()
                .insertImage( this.getLiveAuctionBgImgBlob(), this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height );

            const currentSlide = file.getSlides()[ this.getSlideCount() ];

            // Header (item name — full-width, vertically centered)
            currentSlide.insertShape( this.TEXT_BOX, this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height )
                .getText()
                .setText( item.name )
                .getTextStyle()
                .setFontSize( 30 )
                .setFontFamilyAndWeight( this.playfairDisplayFont, 900 );
            currentSlide.getShapes()[ 0 ].setContentAlignment( this.ALIGN_CONTENT_MIDDLE );
            currentSlide.getShapes()[ 0 ].getText().setText( item.name ).getParagraphStyle().setParagraphAlignment( this.ALIGN_PARAGRAPH_CENTER );

            // Description (left panel)
            currentSlide.insertShape( this.TEXT_BOX, 36, 184.32, 432, 198.72 )
                .getText()
                .setText( item.description )
                .getTextStyle()
                .setFontSize( 14 )
                .setFontFamilyAndWeight( this.playfairDisplayFont, 300 );

            // Right-side metadata panel
            currentSlide.insertShape( this.TEXT_BOX, 468, 184.32, 216, 54 )
                .getText()
                .setText(
                    this.DONATED_BY_TEXT + item.donatedBy +
                    this.ITEM_NUMBER_TEXT + item.id +
                    this.VALUE_TEXT + item.value
                )
                .getTextStyle()
                .setFontSize( 10 )
                .setFontFamilyAndWeight( this.playfairDisplayFont, 500 );

            this.incrementSlideCount_();
        }
    }

    writeOpenAppealSlides_ () {
        const paddleItems = [
            { title: '$500', body: 'A new Water Table for exploring sensory play' },
            { title: '$250', body: 'A classroom multitable for snack, art and exploration' },
            { title: '$100', body: "A new kid's classroom chair - these suckers are expensive!" },
            { title: '$50', body: "A week's worth of art supplies" },
            { title: '$25', body: 'Glue...Because there will never be enough!' }
        ];

        // ── Open Appeal header slide ──────────────────────────────────────
        const file = this.getSlidesFile_();
        file.appendSlide()
            .insertImage( this.getLiveAuctionBgImgBlob(), this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height );

        const headerSlide = file.getSlides()[ this.getSlideCount() ];
        headerSlide.insertTextBox( this.TEXT_BOX, this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height )
            .getText()
            .setText( 'Open Appeal Paddle Raise' )
            .getTextStyle()
            .setFontSize( 30 )
            .setFontFamilyAndWeight( this.playfairDisplayFont, 900 );
        headerSlide.getShapes()[ 0 ].setContentAlignment( this.ALIGN_CONTENT_MIDDLE );
        headerSlide.getShapes()[ 0 ].getText().getParagraphStyle().setParagraphAlignment( this.ALIGN_PARAGRAPH_CENTER );

        // ORNS logo
        headerSlide.insertImage( this.getOrnsLogoBlob(), 63.36, 184.32, 185.04, 185.04 );

        // Description
        file.getSlides()[ this.getSlideCount() ]
            .insertTextBox( this.TEXT_BOX, 266.4, 184.32, 432, 198.72 )
            .getText()
            .setText( this.OPEN_PADDLE_DESCRIPTION )
            .getTextStyle()
            .setFontSize( 14 )
            .setFontFamilyAndWeight( this.playfairDisplayFont, 300 );

        this.incrementSlideCount_();

        // ── Individual paddle-amount slides ───────────────────────────────
        paddleItems.forEach( paddle => {
            const slideTitle = `${ paddle.title }${ this.hardReturn }${ paddle.body }`;
            file.appendSlide()
                .insertImage( this.getLiveAuctionBgImgBlob(), this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height );

            const slide = file.getSlides()[ this.getSlideCount() ];
            slide.insertTextBox( this.TEXT_BOX, this.slidePosition.left, this.slidePosition.top, this.slidePosition.width, this.slidePosition.height )
                .getText()
                .setText( slideTitle )
                .getTextStyle()
                .setFontSize( 30 )
                .setFontFamilyAndWeight( this.playfairDisplayFont, 900 );
            slide.getShapes()[ 0 ].setContentAlignment( this.ALIGN_CONTENT_MIDDLE );
            slide.getShapes()[ 0 ].getText().getParagraphStyle().setParagraphAlignment( this.ALIGN_PARAGRAPH_CENTER );

            this.incrementSlideCount_();
        } );
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    generatePresentation () {
        this.createFileForLiveAuctionPresentation_();
        // this.giveUserHeadsUpAboutLoadingTime_();
        this.writeTitleSlide_();
        this.removeInitialSlide_();
        this.writeDisclaimerSlide_();
        this.writeLiveAuctionItems_();
        this.writeOpenAppealSlides_();
        this.slides.saveAndClose();
    }
}

function createNewPresentation () {
    new LiveAuctionSlides( new AuctionItemManager() ).generatePresentation();
}