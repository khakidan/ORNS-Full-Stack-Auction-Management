/**
 * Data manager. Handles the live auction check-out workflow:
 *   - Verifying the bidder was checked in before allowing check-out
 *   - Guarding against double check-outs
 *   - Optionally triggering receipt generation for live auction winners
 *   - Collecting and recording payment
 *
 * Extracted from AuctionWorkflowManager. Extends GlobalVariables — no
 * spreadsheet column formatting or document styles needed.
 */
class CheckOutManager extends GlobalVariables {
    constructor () {
        super();
        this.uiManager = new UIManager();
        this.bidderManager = new BidderManager();
    }

    // ── Check-out workflow ────────────────────────────────────────────────────

    /**
     * Main entry point for the check-out workflow.
     *   1. Looks up the bidder by ID in the Bidder-Numbers sheet.
     *   2. Verifies they were checked in (guard against never-arrived bidders).
     *   3. Guards against processing the same bidder twice.
     *   4. For live auction winners: triggers receipt generation before payment.
     *   5. Collects and records payment.
     */
    startCheckOutProcess () {
        const s = this.uiManager.strings;
        let bidId = '';
        let data = null;
        let idx = -1;

        while ( true ) {
            const bidIdText = this.uiManager.promptOkCancel( s.checkOutTitle, s.checkOutBidderIdPrompt );
            if ( bidIdText === null ) return;

            bidId = bidIdText.trim();
            if ( bidId === '' ) {
                this.uiManager.showAlert( s.invalidInputTitle, s.blankBidderIdMsg );
                continue;
            }

            data = this.bidderManager.bidders.sheet.getDataRange().getValues();
            idx = data.findIndex( row => row[ 0 ].toString() === bidId );

            if ( idx === -1 ) {
                const tryAgain = this.uiManager.confirmYesNo(
                    s.bidderNotFoundTitle,
                    s.bidderNotFoundRetryMsg( bidId )
                );
                if ( tryAgain ) continue;
                return;
            }
            break;
        }

        const isCheckedIn = data[ idx ][ 4 ] === true;
        const isCheckedOut = data[ idx ][ 6 ] === true;

        if ( !isCheckedIn ) {
            this.uiManager.showAlert( s.notCheckedInTitle, s.notCheckedInMsg( bidId ) );
            return;
        }

        if ( isCheckedOut ) {
            this.uiManager.showAlert( s.alreadyCheckedOutTitle, s.alreadyCheckedOutMsg( bidId ) );
            return;
        }

        const bidderRow = idx + 1;
        const isLiveWinner = this.uiManager.confirmYesNo( s.checkOutTitle, s.liveAuctionWinnerQuestion );

        if ( isLiveWinner ) {
            const itemsEntered = this.uiManager.confirmYesNo( s.checkOutTitle, s.liveItemsEnteredQuestion );
            if ( itemsEntered ) {
                this.generateReceiptForCheckout_( bidId );
                this.processPaymentCollection_( bidderRow );
            } else {
                this.uiManager.showAlert( s.holdOnTitle, s.waitForItemsMsg );
            }
        } else {
            this.processPaymentCollection_( bidderRow );
        }
    }

    /**
     * Prompts for payment confirmation and marks the bidder row as checked out
     * and paid once payment is confirmed.
     * @param {number} row  1-based row index in the Bidder-Numbers sheet.
     */
    processPaymentCollection_ ( row ) {
        const s = this.uiManager.strings;
        const sheet = this.bidderManager.bidders.sheet;
        const isPaid = this.uiManager.confirmYesNo( s.paymentTitle, s.alreadyPaidQuestion );

        if ( isPaid ) {
            sheet.getRange( row, 7, 1, 2 ).setValues( [ [ true, true ] ] );
            this.uiManager.showAlert( s.successTitle, s.checkOutSuccessMsg );
        } else {
            const collected = this.uiManager.confirmOkCancel( s.collectPaymentTitle, s.collectPaymentMsg );
            if ( collected ) {
                sheet.getRange( row, 7, 1, 2 ).setValues( [ [ true, true ] ] );
                this.uiManager.showAlert( s.successTitle, s.checkOutSuccessMsg );
            } else {
                this.uiManager.showAlert( s.checkOutCancelledTitle, s.checkOutCancelledMsg );
            }
        }
    }

    /**
     * Triggers receipt generation for a bidder during check-out by instantiating
     * ReceiptManager (which owns all receipt/email logic).
     * Displays the total due so the volunteer knows what to collect.
     * @param {string|number} bidId
     */
    generateReceiptForCheckout_ ( bidId ) {
        const s = this.uiManager.strings;

        const receiptManager = new ReceiptManager();
        receiptManager.currentBidId = bidId;
        receiptManager.shouldSendEmails = this.uiManager.confirmYesNo(
            s.emailReceiptTitle, s.emailReceiptCheckoutQuestion
        );

        const col = receiptManager.findBidderColInBidSheet_( bidId );
        if ( col === -1 ) return;

        receiptManager.currentReceipt = receiptManager.buildReceipt_( col );
        if ( !receiptManager.currentReceipt.hasWinningItems() ) return;

        receiptManager.handleEmailDispatch_();

        const doc = new ReceiptDoc();
        doc.setDoc_(
            `${ receiptManager.currentReceipt.lastName }, ${ receiptManager.currentReceipt.firstName }`
        );
        doc.writeHeader_();
        doc.writeReceiptBody_( receiptManager.currentReceipt, receiptManager );
        doc.writeFooter_();
        doc.saveAndClose_();
        doc.convertToPdfAndMove_( true );

        const total = receiptManager.currentReceipt.totalCost
            .toLocaleString( 'en-US', { style: 'currency', currency: 'USD' } );

        this.uiManager.showAlert( s.receiptReadyTitle, s.receiptReadyMsg( total ) );
    }
}

function startCheckOutProcess () { new CheckOutManager().startCheckOutProcess(); }