/**
 * Document Generator. Extends DocService so it inherits all style constants,
 * Drive resource access (ORNS logo), file creation, and save/move helpers.
 *
 * Writes the header (logo), body (items table, totals, QR code), and footer
 * (address) of a receipt document. Does not fetch any sheet data itself —
 * it receives a Receipt data model and a ReceiptManager reference for
 * financial calculations.
 *
 * Usage:
 *   const doc = new ReceiptDoc();
 *   doc.setDoc_('Smith, Jane');
 *   doc.writeHeader_();
 *   doc.writeReceiptBody_(receipt, receiptManager);
 *   doc.writeFooter_();
 *   doc.saveAndClose_();
 */
class ReceiptDoc extends DocService {
    constructor ( folderID = null ) {
        super( folderID );
    }

    // ── Header / footer ──────────────────────────────────────────────────────
    writeHeader_ () {
        this.getDoc_().addHeader()
            .insertParagraph( 0, '' )
            .setAlignment( this.horizontalCenter )
            .appendInlineImage( this.getOrnsLogoBlob() )
            .setHeight( 97.08737864078 )
            .setWidth( 97.08737864078 );
    }

    writeFooter_ () {
        this.getDoc_().addFooter()
            .appendParagraph( 'ORCHARD RIDGE NURSERY SCHOOL\n1025 MCKENNA BOULEVARD, MADISON, WI | 608.274.8407' )
            .setAlignment( this.horizontalCenter )
            .setAttributes( this.receiptFooterStyle );
    }

    // ── Body ─────────────────────────────────────────────────────────────────
    /**
     * Writes the full receipt body for one bidder into the current document.
     * @param {Receipt}        receipt        The Receipt data model to render.
     * @param {ReceiptManager} receiptManager Provides financial calculation methods.
     */
    writeReceiptBody_ ( receipt, receiptManager ) {
        const body = this.getDoc_().getBody();

        const adjustedTotal = receiptManager.calculateAdjustedTotalWithFees( receipt.totalCost );
        const paymentUrl = receiptManager.getPaymentLink( adjustedTotal.toFixed( 2 ), receipt.bidId );

        // Title
        body.appendParagraph( `Receipt for [${ receipt.bidId }] ${ receipt.firstName } ${ receipt.lastName }` )
            .setAttributes( this.receiptTitleStyle )
            .appendHorizontalRule();

        body.appendParagraph( 'The following items have been purchased: ' )
            .setAttributes( this.receiptBodyStyle );

        // Items table
        const table = body.appendTable( [ [ 'Auction ID', 'Item Name', 'Winning Bid' ] ] );
        table.setAttributes( this.receiptListStyleHeader )
            .setColumnWidth( 0, 72 )
            .setColumnWidth( 2, 80 );

        for ( let i = 0; i < 3; i++ ) {
            table.getRow( 0 ).getCell( i )
                .setBackgroundColor( this.ornsRed )
                .setForegroundColor( this.white );
        }

        receipt.itemsWon.forEach( ( id, idx ) => {
            const row = table.appendTableRow();
            row.appendTableCell( id.toString() ).setAttributes( this.receiptListStyle );
            row.appendTableCell( receipt.itemNames[ idx ] ).setAttributes( this.receiptListStyle );
            row.appendTableCell( `$${ receipt.itemPrices[ idx ] }` )
                .setAttributes( this.receiptListStyle );
        } );

        // Total
        body.appendParagraph( `\nTotal Due: $${ receipt.totalCost }` )
            .setAttributes( this.receiptTotalDueStyle );

        // ── Thank-you + QR code layout ────────────────────────────────────────
        // Fetch the QR blob before choosing layout to save a network call if it fails.
        const qrBlob = receiptManager.generatePaymentQRCodeBlob( paymentUrl );
        const thankYou = "Thank you for supporting Orchard Ridge Nursery School's Auction. " +
            "Your donations today will ensure that we can continue to provide high quality " +
            "preschool education.\n\nThanks again, \n";

        if ( qrBlob ) {
            // Insert a 1-row, 2-column table for structural layout and hide the borders
            const layoutTable = body.appendTable();
            layoutTable.setBorderWidth( 0 );

            const layoutRow = layoutTable.appendTableRow();
            const leftCell = layoutRow.appendTableCell();
            const rightCell = layoutRow.appendTableCell();

            // Applied requested widths (converted from inches to points)
            layoutTable.setColumnWidth( 0, 383.256 ); // 5.323 inches
            layoutTable.setColumnWidth( 1, 84.744 );  // 1.177 inches

            // --- Left Cell: Thank You and Signature ---
            leftCell.appendParagraph( thankYou )
                .setAttributes( this.receiptBodyStyle )
                .appendText( 'Elizabeth Burke' )
                .setAttributes( this.receiptSignatureStyle );

            leftCell.appendParagraph( 'Orchard Ridge Nursery School\n\n' )
                .setAttributes( this.receiptBodyNoTopSpacingStyle )
                .appendText(
                    'Orchard Ridge Nursery School is a registered 501(c)(3) nonprofit organization.\n' +
                    'Federal Tax ID No: 39-1501336'
                )
                .setAttributes( this.receiptSmallItalicBodyStyle );

            // Clean up the default empty paragraph Docs adds to new cells
            if ( leftCell.getChild( 0 ).asParagraph().getText() === '' ) {
                leftCell.getChild( 0 ).removeFromParent();
            }

            // --- Right Cell: QR Code ---
            rightCell.appendParagraph( 'SCAN TO PAY BY CREDIT CARD' )
                .setAlignment( this.horizontalCenter )
                .setAttributes( this.receiptSmallQRTextStyle );

            const imgPara = rightCell.appendParagraph( '' );
            imgPara.setAlignment( this.horizontalCenter );

            // FIX: Using appendInlineImage instead of appendImage
            const img = imgPara.appendInlineImage( qrBlob );
            img.setWidth( 90 ).setHeight( 90 );

            rightCell.appendParagraph( 'Please note a 3.49% + $0.49 fee will be added to your total.' )
                .setAlignment( this.horizontalCenter )
                .setAttributes( this.receiptSmallQRTextStyle );

            // Clean up the default empty paragraph Docs adds to new cells
            if ( rightCell.getChild( 0 ).asParagraph().getText() === '' ) {
                rightCell.getChild( 0 ).removeFromParent();
            }
        } else {
            // ── Fallback: QR unavailable — write sections as normal paragraphs ─
            body.appendParagraph( thankYou )
                .setAttributes( this.receiptBodyStyle )
                .appendText( 'Elizabeth Burke' )
                .setAttributes( this.receiptSignatureStyle );

            body.appendParagraph( 'Orchard Ridge Nursery School\n\n' )
                .setAttributes( this.receiptBodyNoTopSpacingStyle )
                .appendText(
                    'Orchard Ridge Nursery School is a registered 501(c)(3) nonprofit organization.\n' +
                    'Federal Tax ID No: 39-1501336'
                )
                .setAttributes( this.receiptSmallItalicBodyStyle );
        }
    }
}