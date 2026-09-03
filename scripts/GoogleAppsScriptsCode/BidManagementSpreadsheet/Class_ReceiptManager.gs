/**
 * Data manager. Orchestrates the full receipt lifecycle by coordinating
 * BidderManager, AuctionItemManager, EmailManager, and ReceiptDoc.
 *
 * Responsibilities:
 *   - Look up a bidder's column in the Bid-Management sheet
 *   - Build a Receipt data model from that column's data
 *   - Calculate fees and generate PayPal links
 *   - Dispatch emails via EmailManager
 *   - Delegate doc writing to ReceiptDoc
 *   - Entry points for individual and batch receipt generation
 */
class ReceiptManager extends GlobalVariables {
    constructor ( folderID = null ) {
        super();
        this.folderID = folderID; // ← stored so processBatch_() can pass it to ReceiptDoc
        this.customPaymentUrl = null;
        this.uiManager = new UIManager();
        this.bidderManager = new BidderManager();
        this.auctionItemManager = new AuctionItemManager();
        this.emailManager = new EmailManager();

        this.shouldSendEmails = false;
        this.testEmailOverride = null;
        this.testEmailSent = false;
        this.tableNumber = 0;

        this.currentReceipt = null;
        this.currentBidId = null;
    }

    // ── Bid-sheet data getter ────────────────────────────────────────────────
    /** Lazy-loads the Bid-Management sheet data. */
    get bidManagement () {
        if ( this._bidManagement ) return this._bidManagement;
        const sheet = this.activeSpreadSheet.getSheetByName( this.bidManagementString );
        if ( !sheet ) return { sheet: null, lastRow: 0, lastCol: 0, range: [], loopLength: 0 };

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 0
            ? sheet.getRange( 1, 1, lastRow, lastCol ).getValues()
            : [];

        this._bidManagement = { sheet, lastRow, lastCol, range: dataRange, loopLength: Math.max( 0, lastRow - 1 ) };
        return this._bidManagement;
    }

    // ── Data lookups ─────────────────────────────────────────────────────────
    /**
     * Finds the 0-based column index for a bidder ID in the Bid-Management sheet.
     * @param {string|number} bidId
     * @param {number} [startIndex=0]
     * @returns {number}  Column index, or -1 if not found.
     */
    findBidderColInBidSheet_ ( bidId, startIndex = 0 ) {
        const { range, lastCol } = this.bidManagement;
        if ( !range || !range.length ) return -1;

        for ( let i = startIndex; i < lastCol; i += 2 ) {
            const cellValue = range[ 0 ][ i ];
            // NULL PROTECTION: Skip empty column headers
            if ( cellValue !== null && cellValue !== undefined && cellValue !== '' ) {
                if ( cellValue.toString().trim() === bidId.toString().trim() ) return i;
            }
        }
        return -1;
    }

    /**
     * Looks up the email for a bidder by ID from the Bidder-Numbers full data.
     * @param {string|number} bidId
     * @returns {string}
     */
    getEmailForBidder_ ( bidId ) {
        const fullData = this.bidderManager.biddersFullData;
        if ( !fullData.length ) return '';

        const emailCol = fullData[ 0 ].indexOf( 'Email' );
        if ( emailCol === -1 ) return '';

        for ( let i = 1; i < fullData.length; i++ ) {
            const cellValue = fullData[ i ][ 0 ];
            // NULL PROTECTION: Skip empty rows
            if ( cellValue !== null && cellValue !== undefined && cellValue !== '' ) {
                if ( cellValue.toString().trim() === bidId.toString().trim() ) {
                    return fullData[ i ][ emailCol ] || '';
                }
            }
        }
        return '';
    }

    /**
     * Reads the Bid-Management sheet column for the current bidder and builds
     * a Receipt data model with all won items, names, prices, and total.
     * @param {number} col  0-based column index.
     * @returns {Receipt}
     */
    buildReceipt_ ( col ) {
        const { range, lastRow } = this.bidManagement;
        const firstName = range[ 1 ][ col ];
        const lastName = range[ 1 ][ col + 1 ];
        const email = this.getEmailForBidder_( this.currentBidId );

        const receipt = new Receipt( this.currentBidId, firstName, lastName, email );

        for ( let row = 3; row < lastRow; row++ ) {
            const itemId = range[ row ][ col ];
            const itemPrice = range[ row ][ col + 1 ];
            if ( itemId !== '' && itemId !== undefined && itemId !== null ) {
                const normalizedId = parseFloat( itemId ).toString();
                const itemName = this.auctionItemManager.getItemName( normalizedId );
                receipt.addItem( normalizedId, itemName, itemPrice );
            }
        }

        return receipt;
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
     * Centralized layout link resolver for document components.
     * Delegates heavy generation lifting to the custom PayPalService container.
     *
     * @param {string|number} adjustedTotal - Handled downstream (calculated dynamically by service)
     * @param {string|number} bidderId - Unique identification identifier of the target customer.
     * @return {string} Direct checkout gateway URL.
     */
    getPaymentLink ( adjustedTotal, bidderId ) {
        // 1. If we already generated the URL in the API loop, just return it immediately
        if ( this.customPaymentUrl ) {
            return this.customPaymentUrl;
        }

        // 2. Otherwise, fall back to our unified generator method
        try {
            const col = this.findBidderColInBidSheet_( bidderId.toString() );
            if ( col === -1 ) return "https://www.paypal.com";

            const receipt = this.buildReceipt_( col );
            if ( !receipt.hasWinningItems() ) return "https://www.paypal.com";

            return this.getOrCreateInvoiceUrl( bidderId, receipt );

        } catch ( error ) {
            Logger.log( `💥 [ReceiptManager Fallback Link triggered]: ${ error.toString() }` );
            return "https://www.paypal.com";
        }
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
     * In test mode, only ever sends one email (to the test address).
     */
    handleEmailDispatch_ () {
        if ( !this.shouldSendEmails ) return;
        if ( this.testEmailOverride && this.testEmailSent ) return;

        const targetEmail = this.testEmailOverride || this.currentReceipt.email;
        if ( !targetEmail ) return;

        if ( this.testEmailOverride ) this.testEmailSent = true;

        const adjustedTotal = this.calculateAdjustedTotalWithFees( this.currentReceipt.totalCost );
        const feeAmount = adjustedTotal - this.currentReceipt.totalCost;
        const paymentUrl = this.getPaymentLink( adjustedTotal.toFixed( 2 ), this.currentBidId );

        const receiptCopy = Object.assign( new Receipt(
            this.currentReceipt.bidId, this.currentReceipt.firstName,
            this.currentReceipt.lastName, targetEmail
        ), {
            itemsWon: this.currentReceipt.itemsWon,
            itemNames: this.currentReceipt.itemNames,
            itemPrices: this.currentReceipt.itemPrices,
            totalCost: this.currentReceipt.totalCost
        } );

        const email = this.emailManager.buildReceiptEmail(
            receiptCopy, paymentUrl, adjustedTotal.toFixed( 2 ), feeAmount.toFixed( 2 )
        );
        this.emailManager.send( email );
    }

    // ── Entry points ─────────────────────────────────────────────────────────
    /**
     * Prompts for a single bidder number and generates their receipt.
     */
    createIndividualReceipt () {
        const s = this.uiManager.strings;
        let col = -1;
        let bidIdText = '';

        while ( true ) {
            const input = this.uiManager.promptOkCancel( s.receiptGenerationTitle, s.enterBidderNumberPrompt );
            if ( input === null ) return;

            bidIdText = input.trim();
            if ( bidIdText === '' ) {
                this.uiManager.showAlert( s.invalidInputTitle, s.blankBidderNumberMsg );
                continue;
            }

            col = this.findBidderColInBidSheet_( bidIdText );
            if ( col === -1 ) {
                const tryAgain = this.uiManager.confirmYesNo(
                    s.bidderNotFoundTitle,
                    s.bidderNotFoundReceiptMsg( bidIdText )
                );
                if ( tryAgain ) continue;
                return;
            }
            break;
        }

        this.currentBidId = bidIdText;
        this.currentReceipt = this.buildReceipt_( col );

        if ( !this.currentReceipt.hasWinningItems() ) {
            this.uiManager.showAlert( s.statusTitle, s.noBidsMsg );
            return;
        }

        this.shouldSendEmails = this.uiManager.confirmYesNo( s.emailReceiptTitle, s.emailReceiptQuestion );

        try {
            this.handleEmailDispatch_();

            const doc = new ReceiptDoc();
            doc.setDoc_( `${ this.currentReceipt.lastName }, ${ this.currentReceipt.firstName }` );
            doc.writeHeader_();
            doc.writeReceiptBody_( this.currentReceipt, this );
            doc.writeFooter_();
            doc.saveAndClose_();
            doc.convertToPdfAndMove_( true );

            this.uiManager.showAlert( s.successTitle, s.receiptCreatedSuccessMsg );
        } catch ( e ) {
            this.uiManager.showAlert( s.errorTitle, s.receiptErrorMsg( e.message ) );
        }
    }

    /**
     * Generates receipts for ALL bidders who have won items, split into two
     * batch documents to stay within GAS execution time limits.
     */
    createAllReceipts () {
        const s = this.uiManager.strings;
        const emailResponse = this.uiManager.promptYesNoCancel( s.massEmailTitle, s.massEmailQuestion );

        if ( emailResponse === 'CANCEL' ) return;

        this.shouldSendEmails = ( emailResponse === 'YES' );
        this.bidderManager.sortByLastName_();

        const bidderSheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        const allBidderData = bidderSheet.getDataRange().getValues();
        const totalRows = allBidderData.length;
        const midPoint = Math.ceil( ( totalRows - 1 ) / 2 ) + 1;

        this.processBatch_( 'Receipts - 1st Half', allBidderData, 1, midPoint );
        this.processBatch_( 'Receipts - 2nd Half', allBidderData, midPoint, totalRows );

        this.uiManager.showAlert( s.successTitle, s.batchReceiptsSuccessMsg );
    }

    /**
     * Processes a slice of the bidder list into a single batch receipt document.
     * @param {string}   fileName
     * @param {Array[][]} allBidderData  Full sorted bidder data including header.
     * @param {number}   start
     * @param {number}   end
     */
    processBatch_ ( fileName, allBidderData, start, end ) {
        const doc = new ReceiptDoc( this.folderID );
        doc.setDoc_( fileName );
        doc.writeHeader_();
        this.tableNumber = 0;

        for ( let i = start; i < end; i++ ) {
            try {
                const rawBidderId = allBidderData[ i ][ 0 ];
                // NULL PROTECTION
                if ( rawBidderId === null || rawBidderId === undefined || rawBidderId.toString().trim() === '' ) continue;

                this.currentBidId = rawBidderId.toString().trim();
                const col = this.findBidderColInBidSheet_( this.currentBidId );

                if ( col !== -1 ) {
                    this.currentReceipt = this.buildReceipt_( col );

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
     * Enables test mode — all outgoing emails go to testEmail; only one is sent.
     * @param {string} testEmail
     */
    enableTestMode ( testEmail ) {
        this.testEmailOverride = testEmail;
    }

    /**
     * Sends emails to all winning bidders without creating any Google Documents.
     */
    sendAllEmailsOnly () {
        this.shouldSendEmails = true;
        this.bidderManager.sortByLastName_();

        const bidderSheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        const allBidderData = bidderSheet.getDataRange().getValues();

        // Start from index 1 (skipping header)
        for ( let i = 1; i < allBidderData.length; i++ ) {
            try {
                this.currentBidId = allBidderData[ i ][ 0 ];
                // Skip empty rows to prevent null errors
                if ( this.currentBidId === null || this.currentBidId === undefined || this.currentBidId === '' ) continue;

                const col = this.findBidderColInBidSheet_( this.currentBidId );

                if ( col !== -1 ) {
                    this.currentReceipt = this.buildReceipt_( col );
                    if ( this.currentReceipt.hasWinningItems() ) {
                        // Only handle the email part
                        this.handleEmailDispatch_();
                    }
                }
            } catch ( e ) {
                console.error( `ReceiptManager.sendAllEmailsOnly: error at index ${ i }. ${ e.message }` );
            }
            this.currentReceipt = null;
        }
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

        // ✅ These three lines were missing — without them the method returns undefined,
        //    customPaymentUrl never gets set, and getPaymentLink creates a second invoice.
        bidderSheet.getRange( targetRowIndex, 10 ).setValue( invoiceResult.checkoutUrl );
        bidderSheet.getRange( targetRowIndex, 11 ).setValue( invoiceResult.totalAmount );

        console.log(
            `ReceiptManager.getOrCreateInvoiceUrl: New invoice created for bidder ${ bidderId }.` +
            ` Total: $${ invoiceResult.totalAmount }, URL: ${ invoiceResult.checkoutUrl }`
        );

        return invoiceResult.checkoutUrl;
    }
}

function createAllReceipts () { new ReceiptManager().createAllReceipts(); }
function createIndividualReceipt () { new ReceiptManager().createIndividualReceipt(); }

function testCreateIndividualReceipt () {
    const mgr = new ReceiptManager();
    mgr.enableTestMode( 'sage.dan@gmail.com' );
    mgr.createIndividualReceipt();
}

function testCreateAllReceipts () {
    const mgr = new ReceiptManager();
    mgr.enableTestMode( 'sage.dan@gmail.com' );
    mgr.createAllReceipts();
}
