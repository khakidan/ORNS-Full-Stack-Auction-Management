/**
 * Data manager. Orchestrates the receipt lifecycle by coordinating
 * AuctionItemManager, EmailManager, and ReceiptDoc.
 *
 * Responsibilities:
 *   - Accept an already-built Receipt (Node resolves a bidder's winning
 *     items/total from the Bid-Management sheet - see
 *     server/services/receiptDataService.ts - and passes it in via
 *     Class_GoogleAIStudio.gs's createIndividualReceipt/createAllReceipts;
 *     this class no longer looks any of that up itself)
 *   - Calculate fees and get/create the PayPal invoice link
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
        this.customPaymentUrl = null;
        this.auctionItemManager = new AuctionItemManager();
        this.emailManager = new EmailManager();

        this.shouldSendEmails = false;
        this.tableNumber = 0;

        this.currentReceipt = null;
        this.currentBidId = null;
    }

    // ── Financial helpers ────────────────────────────────────────────────────
    /**
     * Calculates the total with PayPal's actual processing fee (3.49% +
     * $0.49) - delegates to PayPalService.calculatePayPalSurcharge, the
     * exact same formula used to create the real PayPal invoice, so the
     * number shown here always matches what the bidder is actually
     * charged. Previously computed its own, different (and wrong) 2.2% +
     * $0.30 rate - every disclaimer surrounding this value, in this app
     * and the Node app (this receipt's own QR caption, EmailManager's
     * email template, and server/services/emailService.ts), has always
     * said "3.49% + $0.49", confirming that was always the intended rate.
     * @param {number} originalTotal
     * @returns {number}
     */
    calculateAdjustedTotalWithFees ( originalTotal ) {
        if ( originalTotal <= 0 ) return 0;
        return new PayPalService().calculatePayPalSurcharge( originalTotal ).total;
    }

    /**
     * Returns the payment URL for the receipt currently being generated.
     * Always set by createIndividualReceipt/processBatch_ via
     * getOrCreateInvoiceUrl BEFORE any Doc-writing happens (Doc-writing is
     * the only caller of this method), so there is nothing left to look
     * up here.
     * @param {string|number} adjustedTotal - Unused; kept for call-site compatibility with ReceiptDoc.gs.
     * @param {string|number} bidderId - Unused; kept for call-site compatibility with ReceiptDoc.gs.
     * @return {string} Direct checkout gateway URL.
     */
    getPaymentLink ( adjustedTotal, bidderId ) {
        return this.customPaymentUrl || "https://www.paypal.com";
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

        const adjustedTotal = this.calculateAdjustedTotalWithFees( this.currentReceipt.totalCost );
        const feeAmount = adjustedTotal - this.currentReceipt.totalCost;
        const paymentUrl = this.getPaymentLink( adjustedTotal.toFixed( 2 ), this.currentBidId );

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
                    // 1. Get/Create the invoice URL *before* writing the receipt
                    const paymentUrl = this.getOrCreateInvoiceUrl( this.currentBidId, this.currentReceipt );
                    this.customPaymentUrl = paymentUrl;

                    // 2. Add page break if not the first entry
                    if ( this.tableNumber > 0 ) {
                        doc.reopenDoc_();
                        doc.getDoc_().getBody().appendPageBreak();
                    }

                    // 3. Write body (which now uses the correct customPaymentUrl)
                    doc.writeReceiptBody_( this.currentReceipt, this );

                    // 4. Handle email if batch request wants them
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
            this.customPaymentUrl = null; // Reset for next bidder
        }

        doc.reopenDoc_();
        doc.writeFooter_();
        doc.saveAndClose_();
        doc.convertToPdfAndMove_( true );
    }

    /**
     * Resolves the PayPal invoice URL for a bidder using the following precedence:
     *
     *   1. A URL already exists in Column J AND the invoiced amount in Column K
     *      matches the current total-with-fees for this bidder's winning items
     *      → return the existing URL unchanged (no PayPal API call needed).
     *
     *   2. A URL exists in Column J BUT the invoiced amount no longer matches
     *      (i.e. new winning bids were entered since the last run)
     *      → cancel the stale PayPal invoice, then create and store a fresh one.
     *
     *   3. No URL exists in Column J
     *      → create a new PayPal invoice and write the URL + total to J & K.
     *
     * The amount comparison uses a $0.01 tolerance to guard against any
     * floating-point rounding edge cases.
     *
     * @param {string|number} bidderId - The unique ID from Column A of Bidder-Numbers.
     * @param {Receipt}       receipt  - The compiled Receipt data model for this bidder.
     * @returns {string} The public PayPal checkout URL.
     * @throws  {Error}  If the bidder row is not found, or if receipt has no items.
     */
    getOrCreateInvoiceUrl ( bidderId, receipt ) {
        if ( !receipt || !receipt.hasWinningItems() ) {
            throw new Error( `Cannot generate an invoice: Bidder #${ bidderId } has no winning items.` );
        }

        const bidderSheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        const data = bidderSheet.getDataRange().getValues();

        let targetRowIndex = -1;
        let existingUrl = '';
        let existingInvoicedAmount = 0;

        // ── Locate the bidder row ──────────────────────────────────────────────────
        for ( let i = 1; i < data.length; i++ ) {
            const cellValue = data[ i ][ 0 ];
            if ( cellValue === null || cellValue === undefined || cellValue.toString().trim() === '' ) continue;

            if ( cellValue.toString().trim() === bidderId.toString().trim() ) {
                targetRowIndex = i + 1;       // 1-based sheet index
                existingUrl = data[ i ][ 9 ] || '';  // Column J
                existingInvoicedAmount = data[ i ][ 10 ] || 0;   // Column K
                break;
            }
        }

        if ( targetRowIndex === -1 ) {
            throw new Error( `Bidder ID ${ bidderId } not found in the ${ this.bidNumbersString } sheet.` );
        }

        // ── Calculate what the invoice total SHOULD be right now ──────────────────
        const paypal = new PayPalService();
        const expectedTotal = paypal.calculatePayPalSurcharge( receipt.totalCost ).total;

        // ── Case 1: Valid URL exists — check if the amount still matches ───────────
        if ( existingUrl && existingUrl.toString().trim().startsWith( 'http' ) ) {
            const invoicedAmount = parseFloat( existingInvoicedAmount ) || 0;

            if ( Math.abs( invoicedAmount - expectedTotal ) < 0.01 ) {
                console.log(
                    `ReceiptManager.getOrCreateInvoiceUrl: Reusing existing invoice for bidder ${ bidderId }.` +
                    ` Invoiced: $${ invoicedAmount }, Expected: $${ expectedTotal }`
                );
                return existingUrl.toString().trim();
            }

            // ── Case 2: URL exists but amount is stale — cancel it first ────────────
            console.log(
                `ReceiptManager.getOrCreateInvoiceUrl: Amount mismatch for bidder ${ bidderId }.` +
                ` Invoiced: $${ invoicedAmount }, Expected: $${ expectedTotal }. Cancelling stale invoice.`
            );

            const oldInvoiceId = paypal.extractInvoiceIdFromUrl( existingUrl.toString().trim() );
            if ( oldInvoiceId ) {
                try {
                    paypal.cancelInvoice( oldInvoiceId );
                } catch ( e ) {
                    console.warn(
                        `ReceiptManager.getOrCreateInvoiceUrl: Could not cancel invoice ` +
                        `${ oldInvoiceId } for bidder ${ bidderId }. Proceeding to create new invoice. ` +
                        `Reason: ${ e.message }`
                    );
                }
            }
        }

        // ── Case 3 (and fall-through from Case 2): Create a fresh invoice ──────────
        const bidderInfo = {
            email: receipt.email || 'no-reply@example.com',
            firstName: receipt.firstName,
            lastName: receipt.lastName,
            id: bidderId
        };

        const lineItems = receipt.itemNames.map( ( name, i ) => ( {
            name: name,
            amount: Number( receipt.itemPrices[ i ] ) || 0
        } ) );

        const invoiceResult = paypal.createAndSendInvoice( bidderInfo, lineItems );

        bidderSheet.getRange( targetRowIndex, 10 ).setValue( invoiceResult.checkoutUrl );
        bidderSheet.getRange( targetRowIndex, 11 ).setValue( invoiceResult.totalAmount );

        console.log(
            `ReceiptManager.getOrCreateInvoiceUrl: New invoice created for bidder ${ bidderId }.` +
            ` Total: $${ invoiceResult.totalAmount }, URL: ${ invoiceResult.checkoutUrl }`
        );

        return invoiceResult.checkoutUrl;
    }
}
