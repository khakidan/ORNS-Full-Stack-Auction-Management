/**
 * Data manager. Orchestrates the receipt lifecycle by coordinating
 * AuctionItemManager, EmailManager, and ReceiptDoc.
 *
 * Responsibilities:
 *   - Accept an already-built Receipt (Node resolves a bidder's winning
 *     items/total from the Bid-Management sheet, AND their PayPal
 *     invoice URL/adjusted total - see
 *     server/services/receiptDataService.ts - and passes it in via
 *     Class_GoogleAIStudio.gs's createIndividualReceipt/createAllReceipts;
 *     this class no longer looks any of that up itself, and no longer
 *     calls PayPalService at all)
 *   - Dispatch emails via EmailManager
 *   - Delegate doc writing to ReceiptDoc
 *
 * Has no menu-driven entry points of its own - individual and batch
 * receipt generation are driven by GoogleAIStudio.createIndividualReceipt/
 * .createAllReceipts, which construct a ReceiptManager and call its
 * lower-level methods (processBatch_, etc.) directly.
 */
class ReceiptManager extends GlobalVariables {
    constructor ( folderID = null ) {
        super();
        this.folderID = folderID; // ← stored so processBatch_() can pass it to ReceiptDoc
        this.auctionItemManager = new AuctionItemManager();
        this.emailManager = new EmailManager();

        this.shouldSendEmails = false;
        this.tableNumber = 0;

        this.currentReceipt = null;
        this.currentBidId = null;
    }

    /**
     * Fetches a QR code blob for the given URL from quickchart.io.
     * Returns null on network failure.
     * @param {string} paymentUrl
     * @returns {GoogleAppsScript.Base.Blob|null}
     */
    generatePaymentQRCodeBlob ( paymentUrl ) {
        const qrUrl = 'https://quickchart.io/qr?text=' + encodeURIComponent( paymentUrl ) + '&size=200';
        try {
            return UrlFetchApp.fetch( qrUrl ).getBlob();
        } catch ( e ) {
            console.error( `ReceiptManager: QR generation failed. ${ e.message }` );
            return null;
        }
    }

    // ── Email dispatch ───────────────────────────────────────────────────────
    /**
     * Sends the receipt email for the current receipt if email is toggled on.
     */
    handleEmailDispatch_ () {
        if ( !this.shouldSendEmails ) return;
        if ( !this.currentReceipt.email ) return;

        // adjustedTotal/paymentUrl were already resolved by Node (see
        // server/services/receiptDataService.ts's resolveInvoiceUrl) and
        // attached to the receipt via Receipt.fromData - falls back to
        // totalCost/a generic link only if somehow missing.
        const adjustedTotal = this.currentReceipt.adjustedTotal != null ? this.currentReceipt.adjustedTotal : this.currentReceipt.totalCost;
        const feeAmount = adjustedTotal - this.currentReceipt.totalCost;
        const paymentUrl = this.currentReceipt.paymentUrl || 'https://www.paypal.com';

        const email = this.emailManager.buildReceiptEmail(
            this.currentReceipt, paymentUrl, adjustedTotal.toFixed( 2 ), feeAmount.toFixed( 2 )
        );
        this.emailManager.send( email );
    }

    // ── Entry points ─────────────────────────────────────────────────────────
    /**
     * Processes a slice of the already-built receipt list into a single
     * batch receipt document.
     * @param {string}   fileName
     * @param {Object[]} receipts  Already-built receipt data (see
     *   server/services/receiptDataService.ts's buildAllBidderReceipts),
     *   sorted ascending by last name, already filtered to bidders with
     *   at least one winning item.
     * @param {number}   start
     * @param {number}   end
     */
    processBatch_ ( fileName, receipts, start, end ) {
        const doc = new ReceiptDoc( this.folderID );
        doc.setDoc_( fileName );
        doc.writeHeader_();
        this.tableNumber = 0;

        for ( let i = start; i < end; i++ ) {
            try {
                const data = receipts[ i ];
                if ( !data ) continue;

                this.currentBidId = data.bidId.toString().trim();
                this.currentReceipt = Receipt.fromData( data );

                if ( this.currentReceipt.hasWinningItems() ) {
                    // 1. Add page break if not the first entry
                    if ( this.tableNumber > 0 ) {
                        doc.reopenDoc_();
                        doc.getDoc_().getBody().appendPageBreak();
                    }

                    // 2. Write body - paymentUrl/adjustedTotal were already
                    // resolved by Node and are on this.currentReceipt (see
                    // Receipt.fromData)
                    doc.writeReceiptBody_( this.currentReceipt, this );

                    // 3. Handle email if batch request wants them
                    if ( this.shouldSendEmails ) {
                        this.handleEmailDispatch_();
                    }

                    this.tableNumber++;
                    if ( this.tableNumber % 10 === 0 ) doc.saveAndClose_();
                }
            } catch ( e ) {
                console.error( `ReceiptManager.processBatch_: error at index ${ i }. ${ e.message }` );
            }
            this.currentReceipt = null;
        }

        doc.reopenDoc_();
        doc.writeFooter_();
        doc.saveAndClose_();
        doc.convertToPdfAndMove_( true );
    }
}
