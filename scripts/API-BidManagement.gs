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
   * Triggers batch emailing for all winners.
   * Generates/Fetches invoices, updates the sheet, and emails the results out.
   * @returns {{success: boolean, error?: string}}
   */
  sendAllEmails() {
    const mgr = new ReceiptManager();
    mgr.shouldSendEmails = true;
    
    const bidderSheet = mgr.activeSpreadSheet.getSheetByName(mgr.bidNumbersString);
    const allData = bidderSheet.getDataRange().getValues();
    
    // Iterate through all rows skipping header
    for (let i = 1; i < allData.length; i++) {
      const rawBidderId = allData[i][0];
      
      // NULL PROTECTION: If the cell is blank, empty, or undefined, skip this row entirely
      if (rawBidderId === null || rawBidderId === undefined || rawBidderId.toString().trim() === "") {
        continue;
      }
      
      const bidderId = rawBidderId.toString().trim();
      const col = mgr.findBidderColInBidSheet_(bidderId);
      if (col === -1) continue; // Bidder skipped or not in matrix
      
      // CRITICAL FIX: Set the ID into the manager BEFORE calling buildReceipt_
      mgr.currentBidId = bidderId;
      
      const receipt = mgr.buildReceipt_(col);
      if (!receipt.hasWinningItems()) continue; // Skip if no items won
      
      // Ensure invoice is generated and get URL
      const paymentUrl = mgr.getOrCreateInvoiceUrl(bidderId, receipt);
      
      // Inject paymentUrl into manager scope for email content formatting injection
      mgr.customPaymentUrl = paymentUrl; 
      mgr.currentReceipt = receipt;
      
      // Dispatch email
      mgr.handleEmailDispatch_();
    }
    return { success: true };
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
   * Individual target endpoint for single email pushes.
   * @param {string|number} bidderId
   * @returns {{success: boolean, error?: string}}
   */
  sendReceiptEmail(bidderId) {
    if (bidderId === null || bidderId === undefined || bidderId.toString().trim() === "") {
      return { success: false, error: "Provided Bidder ID is empty or invalid." };
    }
    
    const sanitizedId = bidderId.toString().trim();
    const mgr = new ReceiptManager();
    mgr.currentBidId = sanitizedId;
    mgr.shouldSendEmails = true;
    
    const col = mgr.findBidderColInBidSheet_(sanitizedId);
    if (col === -1) throw new Error("Bidder column not found in Bid-Management");
    
    mgr.currentReceipt = mgr.buildReceipt_(col);
    if (!mgr.currentReceipt.hasWinningItems()) throw new Error("No items won for this bidder");
    
    // Ensure invoice exists and pass URL to internal email template compiler
    mgr.customPaymentUrl = mgr.getOrCreateInvoiceUrl(sanitizedId, mgr.currentReceipt);
    
    mgr.handleEmailDispatch_();
    return { success: true };
  }

  /**
   * Bridge function to create a walk-in ticket from the external app.
   * @param {string} firstName
   * @param {string} lastName
   * @param {string} email
   * @returns {{success: boolean, bidder?: {id: number, firstName: string, lastName: string}, error?: string}}
   */
  createWalkInTicket(firstName, lastName, email) {
    const mgr = new CheckInManager();
    const bidderSheet  = mgr.bidderManager.bidders.sheet;
    const bidMgmtSheet = mgr.bidManagement.sheet;
    const data         = bidderSheet.getDataRange().getValues();

    const formatName        = str => str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : '';
    const formattedFirst    = formatName(firstName);
    const formattedLastName = formatName(lastName);
    const formattedEmail    = (email || "").trim();

    // Calculate new ID
    const maxId  = data.slice(1).reduce((max, row) => Math.max(max, parseInt(row[0]) || 0), 100);
    const newId  = maxId + 1;
    const newRow = bidderSheet.getLastRow() + 1;

    // 1. Add to Bidder-Numbers (mark as checked-in)
    bidderSheet.getRange(newRow, 1, 1, 4).setValues([[newId, formattedFirst, formattedLastName, formattedEmail]]);
    bidderSheet.getRange(newRow, 5, 1, 4).insertCheckboxes();
    bidderSheet.getRange(newRow, 5).setValue(true);

    // 2. Add to Bid-Management
    const lastCol = bidMgmtSheet.getLastColumn();
    bidMgmtSheet.insertColumnsAfter(lastCol, 2);
    const newCol = lastCol + 1;

    bidMgmtSheet.getRange(1, newCol).setValue(newId);
    bidMgmtSheet.getRange(2, newCol, 1, 2).setValues([[formattedFirst, formattedLastName]]).setFontWeight('bold');
    bidMgmtSheet.getRange(3, newCol, 1, 2).setValues([['Item #:', 'Price:']]);
    bidMgmtSheet.getRange(1, newCol, 1, 2).mergeAcross().setHorizontalAlignment('center');
    
    // Add Walk-In Ticket Item
    bidMgmtSheet.getRange(4, newCol, 1, 2).setValues([[mgr.walkInTicketItemId, mgr.walkInTicketPrice]]);

    return { 
      success: true, 
      bidder: { id: newId, firstName: formattedFirst, lastName: formattedLastName } 
    };
  }

  /**
   * Backs up existing sheets and runs the setup over again.
   * @returns {{success: boolean, error?: string}}
   */
  syncBidders() {
    const activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Create timestamp for backups
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    // Backup Bid-Management sheet
    const bidMgmtSheet = activeSpreadSheet.getSheetByName('Bid-Management');
    if (bidMgmtSheet) {
      bidMgmtSheet.setName(`Bid-Management (Backup ${timestamp})`);
      bidMgmtSheet.hideSheet();
    }
    
    // Backup Bidder-Numbers sheet
    const bidderNumbersSheet = activeSpreadSheet.getSheetByName('Bidder-Numbers');
    if (bidderNumbersSheet) {
      bidderNumbersSheet.setName(`Bidder-Numbers (Backup ${timestamp})`);
      bidderNumbersSheet.hideSheet();
    }

    // Run the setup classes natively directly from your Apps Script infrastructure
    setupBiddersSheet();
    createBidMgmtSheet();

    return { success: true };
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

function apiSendAllEmails() {
  try {
    return new GoogleAIStudio().sendAllEmails();
  } catch (e) {
    return { success: false, error: e.toString() };
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

function apiSendReceiptEmail(bidderId) {
  try {
    return new GoogleAIStudio().sendReceiptEmail(bidderId);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function apiCreateWalkInTicket(firstName, lastName, email) {
  try {
    return new GoogleAIStudio().createWalkInTicket(firstName, lastName, email);
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function apiSyncBidders() {
  try {
    return new GoogleAIStudio().syncBidders();
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