/**
 * BRIDGE FUNCTIONS FOR WEB APP API
 * These allow the external app to trigger internal class methods.
 */

/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * This encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction management system architecture.
 */
class GoogleAIStudio {
  constructor() {
    // Initialization hook ready for future instance contexts
  }

  /**
	 * Triggers batch printing layout receipts.
	 * Uses the original processBatch_ workflow to limit file creation to 2 documents.
	 * Bidders are sorted alphabetically by last name in memory — the sheet is not modified.
	 * @returns {{success: boolean, error?: string}}
	 */
	createAllReceipts() {
	    const mgr = new ReceiptManager();
	    mgr.shouldSendEmails = false;
	
	    // Sort in memory via BidderManager — no sheet mutation.
	    const allData   = mgr.bidderManager.getSortedBidderData_();
	    const totalRows = allData.length;
	    const midPoint  = Math.ceil((totalRows - 1) / 2) + 1;
	
	    mgr.processBatch_('Receipts - 1st Half', allData, 1, midPoint);
	    mgr.processBatch_('Receipts - 2nd Half', allData, midPoint, totalRows);
	
	    return { success: true };
	}

  /**
   * Clean production pipeline for processing individual external endpoint receipt builds.
   * @param {string|number} bidderId
   * @param {boolean} emailReceipt
   * @returns {{success: boolean, docId?: string, subtotal?: number, paymentUrl?: string, error?: string}}
   */
  createIndividualReceipt(bidderId, emailReceipt) {
    if (bidderId === null || bidderId === undefined || bidderId.toString().trim() === "") {
      return { success: false, error: "Provided Bidder ID is empty or invalid." };
    }
    
    const sanitizedId = bidderId.toString().trim();
    const mgr = new ReceiptManager();
    mgr.currentBidId = sanitizedId;
    
    const col = mgr.findBidderColInBidSheet_(mgr.currentBidId);
    if (col === -1) return { success: false, error: "Bidder ID not found in matrix." };
    
    mgr.currentReceipt = mgr.buildReceipt_(col);
    if (!mgr.currentReceipt.hasWinningItems()) return { success: false, error: "No items won." };

    // Centralized Invoice Workflow Entry point 
    const paymentUrl = mgr.getOrCreateInvoiceUrl(sanitizedId, mgr.currentReceipt);
    mgr.customPaymentUrl = paymentUrl;

    if (emailReceipt === true) {
      mgr.handleEmailDispatch_();
    }

    // Process output documents with accurate QR payload
    const doc = new ReceiptDoc();
    doc.setDoc_(`${mgr.currentReceipt.lastName}, ${mgr.currentReceipt.firstName}`);
    doc.writeHeader_();
    doc.writeReceiptBody_(mgr.currentReceipt, mgr);
    doc.writeFooter_();
    doc.saveAndClose_();
    const newPdfId = doc.convertToPdfAndMove_(true);

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
  recordPayment(bidderId, paymentMethod) {
    // Input validation
    if (bidderId === null || bidderId === undefined || bidderId.toString().trim() === '') {
        return { success: false, error: 'Bidder ID is required.' };
    }

    const sanitizedId = bidderId.toString().trim();
    const methodLower = (paymentMethod || '').toString().trim().toLowerCase();
    let displayLabel = '';
    let paypalMethod = null;

    if (methodLower === 'cash') {
        displayLabel = 'Cash';
        paypalMethod = 'CASH';
    } else if (methodLower === 'check') {
        displayLabel = 'Check';
        paypalMethod = 'CHECK';
    } else if (methodLower === 'credit_card') {
        displayLabel = 'Credit Card / PayPal';
        paypalMethod = null;
    } else {
        return {
            success: false,
            error: `Unknown payment method: "${paymentMethod}". Use 'cash', 'check', or 'credit_card'.`
        };
    }

    // Look up bidder in Bidder-Numbers
    const activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
    const bidderSheet = activeSpreadSheet.getSheetByName('Bidder-Numbers');
    if (!bidderSheet) {
        return { success: false, error: 'Bidder-Numbers sheet not found.' };
    }

    const data = bidderSheet.getDataRange().getValues();
    let targetRowIndex = -1;
    let invoiceUrl = '';
    let invoicedAmount = 0;

    for (let i = 1; i < data.length; i++) {
        const cellValue = data[i][0];
        if (cellValue === null || cellValue === undefined || cellValue.toString().trim() === '') continue;

        if (cellValue.toString().trim() === sanitizedId) {
            targetRowIndex = i + 1;
            invoiceUrl = data[i][9] || ''; // Column J — Invoice URL
            invoicedAmount = data[i][10] || 0; // Column K — Invoiced Amount
            break;
        }
    }

    if (targetRowIndex === -1) {
        return { success: false, error: `Bidder ID ${sanitizedId} not found in Bidder-Numbers.` };
    }

    // Attempt to record payment on PayPal for cash/check
    let paypalRecorded = false;

    if (paypalMethod !== null) {
        const hasInvoiceUrl = invoiceUrl && invoiceUrl.toString().trim().startsWith('http');
        const hasInvoiceAmount = parseFloat(invoicedAmount) > 0;

        if (hasInvoiceUrl && hasInvoiceAmount) {
            const paypal = new PayPalService();
            const invoiceId = paypal.extractInvoiceIdFromUrl(invoiceUrl.toString().trim());

            if (invoiceId) {
                try {
                    paypalRecorded = paypal.recordOfflinePayment(
                        invoiceId,
                        paypalMethod,
                        parseFloat(invoicedAmount)
                    );

                    if (paypalRecorded) {
                        console.log(`apiRecordPayment: PayPal offline payment recorded for bidder ${sanitizedId}. Invoice: ${invoiceId}, Method: ${paypalMethod}, Amount: $${parseFloat(invoicedAmount).toFixed(2)}`);
                    } else {
                        console.warn(`apiRecordPayment: PayPal API call failed or returned false for bidder ${sanitizedId}. Invoice: ${invoiceId}`);
                    }
                } catch (err) {
                    console.error(`apiRecordPayment: PayPal record failed: ${err.toString()}`);
                }
            }
        }
    }

    // Mark as checked out & paid in sheet
    bidderSheet.getRange(targetRowIndex, 7).setValue(true); // Col G (Paid Checkbox)
    bidderSheet.getRange(targetRowIndex, 8).setValue(true); // Col H (Checked Out Checkbox)
    bidderSheet.getRange(targetRowIndex, 9).setValue(displayLabel); // Col I (Method Label)

    console.log(`apiRecordPayment: Bidder ${sanitizedId} marked as paid via ${displayLabel}.`);

    return {
        success: true,
        paypalRecorded: paypalRecorded
    };
  }
}

function apiCreateAllReceipts() {
  try {
    return new GoogleAIStudio().createAllReceipts();
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function apiCreateIndividualReceipt(bidderId, emailReceipt) {
  try {
    return new GoogleAIStudio().createIndividualReceipt(bidderId, emailReceipt);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function apiRecordPayment(bidderId, paymentMethod) {
  try {
    return new GoogleAIStudio().recordPayment(bidderId, paymentMethod);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}