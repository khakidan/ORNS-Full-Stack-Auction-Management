/**
 * Data manager. Orchestrates the receipt lifecycle by coordinating
 * AuctionItemManager and ReceiptDoc.
 *
 * Responsibilities:
 *   - Accept an already-built Receipt (Node resolves a bidder's winning
 *     items/total from the Bid-Management sheet, AND their PayPal
 *     invoice URL/adjusted total - see
 *     server/services/receiptDataService.ts - and passes it in via
 *     Class_GoogleAIStudio.gs's createIndividualReceipt/createAllReceipts;
 *     this class no longer looks any of that up itself, and no longer
 *     calls PayPalService at all)
 *   - Delegate doc writing to ReceiptDoc
 *
 * Has no menu-driven entry points of its own - individual and batch
 * receipt generation are driven by GoogleAIStudio.createIndividualReceipt/
 * .createAllReceipts, which construct a ReceiptManager and call its
 * lower-level methods (processBatch_, etc.) directly.
 *
 * No longer dispatches emails itself - Class_EmailManager.gs/Class_Email.gs
 * (GmailApp.sendEmail, triggered via a `shouldSendEmails`/`emailReceipt`
 * flag no live caller ever set to true) are deleted; the app's one real
 * "email a receipt" feature is Node's /email-only and /email-all routes
 * (server/services/emailService.ts). See
 * docs/agents/refactor-opportunities.md's Code Hardening item #2, Step 5
 * / CHANGELOG.md.
 */
class ReceiptManager extends GlobalVariables {
    constructor ( folderID = null ) {
        super();
        this.folderID = folderID; // ← stored so processBatch_() can pass it to ReceiptDoc
        this.auctionItemManager = new AuctionItemManager();

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
