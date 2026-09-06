/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * This encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction management system architecture.
 */
class GoogleAIStudio extends GlobalVariables { // ◄ Added 'extends GlobalVariables'
    /**
     * @param {Object} [overrides] Optional dependency injection, used by unit
     *   tests - forwarded to `GlobalVariables` (activeSpreadSheet/config) plus
     *   an optional `paypalService` instance `recordPayment` uses in place of
     *   constructing its own `new PayPalService()`. Production call sites
     *   (`new GoogleAIStudio()`) never pass this.
     */
    constructor ( overrides = {} ) {
        super( overrides );
        this.paypalService = overrides.paypalService || null;
    }

    /**
     * Triggers batch printing layout receipts.
     * @param {string|null} folderID  Drive folder ID passed in from the API call.
     * @param {Object[]} receipts  Already-built receipt data for every
     *   bidder with at least one winning item, sorted ascending by last
     *   name - see server/services/receiptDataService.ts's
     *   buildAllBidderReceipts. Node resolves this itself now instead of
     *   this class looking it up - see
     *   docs/agents/refactor-opportunities.md's Code Hardening item #2 /
     *   CHANGELOG.md.
     * @returns {{success: boolean, error?: string}}
     */
    createAllReceipts ( folderID = null, receipts = [] ) {
        const mgr = new ReceiptManager( folderID ); // ← folderID threaded to ReceiptManager
        mgr.shouldSendEmails = false;

        const totalRows = receipts.length;
        const midPoint = Math.ceil( totalRows / 2 );

        mgr.processBatch_( 'Receipts - 1st Half', receipts, 0, midPoint );
        mgr.processBatch_( 'Receipts - 2nd Half', receipts, midPoint, totalRows );

        return { success: true };
    }

    /**
     * Clean production pipeline for processing individual external endpoint receipt builds.
     * @param {string|number} bidderId
     * @param {boolean}       emailReceipt
     * @param {string|null}   folderID  Drive folder ID passed in from the API call.
     * @param {Object|null}   receiptData  Already-built receipt data for
     *   this bidder, including the already-resolved PayPal `paymentUrl`/
     *   `adjustedTotal` - see
     *   server/services/receiptDataService.ts's
     *   buildBidderReceiptWithInvoice. Node resolves this itself now
     *   instead of this class looking it up (and no longer calls
     *   PayPalService at all) - see
     *   docs/agents/refactor-opportunities.md's Code Hardening item #2 /
     *   CHANGELOG.md.
     * @returns {{success: boolean, docId?: string, subtotal?: number, paymentUrl?: string, error?: string}}
     */
    createIndividualReceipt ( bidderId, emailReceipt, folderID = null, receiptData = null ) {
        if ( bidderId === null || bidderId === undefined || bidderId.toString().trim() === '' ) {
            return { success: false, error: 'Provided Bidder ID is empty or invalid.' };
        }
        if ( !receiptData ) {
            return { success: false, error: 'No receipt data provided.' };
        }
        if ( !receiptData.paymentUrl ) {
            return { success: false, error: 'No payment URL provided.' };
        }

        const sanitizedId = bidderId.toString().trim();
        const mgr = new ReceiptManager();
        mgr.currentBidId = sanitizedId;
        mgr.currentReceipt = Receipt.fromData( receiptData );

        if ( !mgr.currentReceipt.hasWinningItems() ) return { success: false, error: 'No items won.' };

        const paymentUrl = mgr.currentReceipt.paymentUrl;

        if ( emailReceipt === true ) {
            mgr.handleEmailDispatch_();
        }

        const doc = new ReceiptDoc( folderID ); // ← folderID passed directly to ReceiptDoc
        doc.setDoc_( `${ mgr.currentReceipt.lastName }, ${ mgr.currentReceipt.firstName }` );
        doc.writeHeader_();
        doc.writeReceiptBody_( mgr.currentReceipt, mgr );
        doc.writeFooter_();
        doc.saveAndClose_();
        const newPdfId = doc.convertToPdfAndMove_( true );

        return {
            success: true,
            docId: newPdfId,
            subtotal: mgr.currentReceipt.totalCost,
            paymentUrl: paymentUrl
        };
    }

    /**
     * Records payment for a bidder — both on the PayPal invoice (for cash/check) and
     * in the Bidder-Numbers sheet.
     * @param {string|number} bidderId
     * @param {string} paymentMethod 'cash' | 'check' | 'credit_card'
     * @returns {{ success: boolean, error?: string, paypalRecorded?: boolean }}
     */
    // recordPayment(bidderId, paymentMethod) {
    //   // Input validation
    //   if (bidderId === null || bidderId === undefined || bidderId.toString().trim() === '') {
    //       return { success: false, error: 'Bidder ID is required.' };
    //   }

    //   const sanitizedId = bidderId.toString().trim();
    //   const methodLower = (paymentMethod || '').toString().trim().toLowerCase();
    //   let displayLabel = '';
    //   let paypalMethod = null;

    //   if (methodLower === 'cash') {
    //       displayLabel = 'Cash';
    //       paypalMethod = 'CASH';
    //   } else if (methodLower === 'check') {
    //       displayLabel = 'Check';
    //       paypalMethod = 'CHECK';
    //   } else if (methodLower === 'credit_card') {
    //       displayLabel = 'Credit Card / PayPal';
    //       paypalMethod = null;
    //   } else {
    //       return {
    //           success: false,
    //           error: `Unknown payment method: "${paymentMethod}". Use 'cash', 'check', or 'credit_card'.`
    //       };
    //   }

    //   // Look up bidder in Bidder-Numbers
    //   const activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
    //   const bidderSheet = activeSpreadSheet.getSheetByName('Bidder-Numbers');
    //   if (!bidderSheet) {
    //       return { success: false, error: 'Bidder-Numbers sheet not found.' };
    //   }

    //   const data = bidderSheet.getDataRange().getValues();
    //   let targetRowIndex = -1;
    //   let invoiceUrl = '';
    //   let invoicedAmount = 0;

    //   for (let i = 1; i < data.length; i++) {
    //       const cellValue = data[i][0];
    //       if (cellValue === null || cellValue === undefined || cellValue.toString().trim() === '') continue;

    //       if (cellValue.toString().trim() === sanitizedId) {
    //           targetRowIndex = i + 1;
    //           invoiceUrl = data[i][9] || ''; // Column J — Invoice URL
    //           invoicedAmount = data[i][10] || 0; // Column K — Invoiced Amount
    //           break;
    //       }
    //   }

    //   if (targetRowIndex === -1) {
    //       return { success: false, error: `Bidder ID ${sanitizedId} not found in Bidder-Numbers.` };
    //   }

    //   // Attempt to record payment on PayPal for cash/check
    //   let paypalRecorded = false;

    //   if (paypalMethod !== null) {
    //       const hasInvoiceUrl = invoiceUrl && invoiceUrl.toString().trim().startsWith('http');
    //       const hasInvoiceAmount = parseFloat(invoicedAmount) > 0;

    //       if (hasInvoiceUrl && hasInvoiceAmount) {
    //           const paypal = new PayPalService();
    //           const invoiceId = paypal.extractInvoiceIdFromUrl(invoiceUrl.toString().trim());

    //           if (invoiceId) {
    //               try {
    //                   paypalRecorded = paypal.recordOfflinePayment(
    //                       invoiceId,
    //                       paypalMethod,
    //                       parseFloat(invoicedAmount)
    //                   );

    //                   if (paypalRecorded) {
    //                       console.log(`apiRecordPayment: PayPal offline payment recorded for bidder ${sanitizedId}. Invoice: ${invoiceId}, Method: ${paypalMethod}, Amount: $${parseFloat(invoicedAmount).toFixed(2)}`);
    //                   } else {
    //                       console.warn(`apiRecordPayment: PayPal API call failed or returned false for bidder ${sanitizedId}. Invoice: ${invoiceId}`);
    //                   }
    //               } catch (err) {
    //                   console.error(`apiRecordPayment: PayPal record failed: ${err.toString()}`);
    //               }
    //           }
    //       }
    //   }

    //   // Mark as checked out & paid in sheet
    //   bidderSheet.getRange(targetRowIndex, 7).setValue(true); // Col G (Checked Out Checkbox)
    //   bidderSheet.getRange(targetRowIndex, 8).setValue(true); // Col H (Paid Checkbox)
    //   bidderSheet.getRange(targetRowIndex, 9).setValue(displayLabel); // Col I (Method Label)

    //   console.log(`apiRecordPayment: Bidder ${sanitizedId} marked as paid via ${displayLabel}.`);

    //   return {
    //       success: true,
    //       paypalRecorded: paypalRecorded
    //   };
    // }

    /**
     * Records a payment method for a bidder, validating credit cards 
     * in real-time or deferring them to the background sweeper loop.
     * @param {string} bidderId The bidder number to check out.
     * @param {string} paymentMethod 'cash' | 'check' | 'credit_card'
     */
    recordPayment ( bidderId, paymentMethod ) {
        const sheet = this.activeSpreadSheet.getSheetByName( this.bidNumbersString );
        if ( !sheet ) throw new Error( `Sheet '${ this.bidNumbersString }' not found.` );

        const data = sheet.getDataRange().getValues();
        let targetRowIndex = -1;
        let invoiceUrlCell = "";
        let invoicedAmountCell = 0;

        // Locate bidder row
        for ( let i = 1; i < data.length; i++ ) {
            if ( String( data[ i ][ 0 ] ).trim() === String( bidderId ).trim() ) {
                targetRowIndex = i + 1; // 1-based sheet row coordinate
                invoiceUrlCell = data[ i ][ 9 ]; // Column J (0-indexed 9) holds the Invoice URL
                invoicedAmountCell = data[ i ][ 10 ] || 0; // Column K (0-indexed 10) holds the Invoiced Amount
                break;
            }
        }

        if ( targetRowIndex === -1 ) {
            return { success: false, error: "Bidder ID not found" };
        }

        const paypal = this.paypalService || new PayPalService();
        const invoiceId = paypal.extractInvoiceIdFromUrl( invoiceUrlCell );

        // --- BRANCH 1: Offline Payment Methods (Instant Checkout Completion) ---
        if ( paymentMethod === "cash" || paymentMethod === "check" ) {
            const label = paymentMethod === "cash" ? "Cash" : "Check";
            sheet.getRange( targetRowIndex, 7 ).setValue( true );  // Column G: Checked Out? -> Checked
            sheet.getRange( targetRowIndex, 8 ).setValue( true );  // Column H: Paid? -> Checked
            sheet.getRange( targetRowIndex, 9 ).setValue( label ); // Column I: Method Label
            sheet.getRange( targetRowIndex, 12 ).clearContent(); // Column L: Clear any stale timestamp

            try {
                if ( invoiceId ) paypal.recordOfflinePayment( invoiceId, label, parseFloat( invoicedAmountCell ) || 0 );
            } catch ( e ) {
                console.warn( "PayPal physical payment recording bypassed/failed: " + e.message );
                return { success: true, deferred: false, paypalRecorded: false };
            }
            return { success: true, deferred: false, paypalRecorded: true };
        }

        // --- BRANCH 2: Credit Card / PayPal (Live Gate Verification) ---
        if ( paymentMethod === "credit_card" ) {
            try {
                let liveStatus = "UNPAID";

                if ( invoiceId ) {
                    liveStatus = paypal.getInvoiceStatus( invoiceId );
                }

                if ( liveStatus === "PAID" ) {
                    // Instant validation success path
                    sheet.getRange( targetRowIndex, 7 ).setValue( true );  // Column G: Checked Out?
                    sheet.getRange( targetRowIndex, 8 ).setValue( true );  // Column H: Paid?
                    sheet.getRange( targetRowIndex, 9 ).setValue( "Credit Card / PayPal" ); // Column I
                    sheet.getRange( targetRowIndex, 12 ).clearContent(); // Column L: Clear timestamp
                    return { success: true, deferred: false, status: "PAID" };
                } else {
                    // Deferred validation path: hand-off to the background Sweeper Trigger
                    sheet.getRange( targetRowIndex, 7 ).setValue( false ); // Column G: Checked Out? -> Unchecked
                    sheet.getRange( targetRowIndex, 8 ).setValue( false ); // Column H: Paid? -> Unchecked
                    sheet.getRange( targetRowIndex, 9 ).setValue( "PayPal Verification Pending" ); // Column I: System string
                    sheet.getRange( targetRowIndex, 12 ).setValue( new Date().toISOString() ); // Column L (Index 11): ISO timestamp

                    return { success: true, deferred: true, status: liveStatus };
                }
            } catch ( err ) {
                throw new Error( "Credit Card validation processing error: " + err.message );
            }
        }

        throw new Error( "Unknown checkout payment method specified: " + paymentMethod );
    }
}

function apiCreateAllReceipts ( folderID, receipts ) {
    try {
        // BUG FIX: this bridge function used to drop `receipts` entirely -
        // it never forwarded it to createAllReceipts, so every real batch
        // call from Node (which always sends a receipts array as the 2nd
        // Apps Script parameter) silently ran with an empty list. See
        // docs/agents/CHANGELOG.md.
        return new GoogleAIStudio().createAllReceipts( folderID, receipts );
    } catch ( e ) {
        return { success: false, error: e.toString() };
    }
}

function apiCreateIndividualReceipt ( bidderId, emailReceipt, folderID, receiptData ) {
    try {
        // BUG FIX: this bridge function used to drop `receiptData` entirely -
        // it never forwarded it to createIndividualReceipt, so every real
        // call from Node (which always sends the resolved receipt as the
        // 4th Apps Script parameter) failed with "No receipt data
        // provided." See docs/agents/CHANGELOG.md.
        return new GoogleAIStudio().createIndividualReceipt( bidderId, emailReceipt, folderID, receiptData );
    } catch ( e ) {
        return { success: false, error: e.toString() };
    }
}

function apiRecordPayment ( bidderId, paymentMethod ) {
    try {
        return new GoogleAIStudio().recordPayment( bidderId, paymentMethod );
    } catch ( e ) {
        return { success: false, error: e.toString() };
    }
}