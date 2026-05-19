/**
 * BRIDGE FUNCTIONS FOR WEB APP API
 * These allow the external app to trigger internal class methods.
 */

function apiCreateAllReceipts() {
  return executeBatchProcess_(false);
}

/**
 * Triggers batch emailing for all winners WITHOUT creating documents.
 */
function apiSendAllEmails() {
  try {
    const mgr = new ReceiptManager();
    // Use the new email-only method
    mgr.sendAllEmailsOnly();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

function executeBatchProcess_(sendEmails) {
  try {
    const mgr = new ReceiptManager();
    mgr.shouldSendEmails = sendEmails;
    mgr.bidderManager.sortByLastName_();

    const bidderSheet = mgr.activeSpreadSheet.getSheetByName(mgr.bidNumbersString);
    const allData = bidderSheet.getDataRange().getValues();
    const totalRows = allData.length;
    const mid = Math.ceil((totalRows - 1) / 2) + 1;

    mgr.processBatch_('Receipts - 1st Half', allData, 1, mid);
    mgr.processBatch_('Receipts - 2nd Half', allData, mid, totalRows);

    return { success: true };
  } catch (e) { return { success: false, error: e.toString() }; }
}

/**
 * Triggers an individual email resend.
 * @param {string|number} bidderId
 */
function apiSendReceiptEmail(bidderId) {
  try {
    const mgr = new ReceiptManager();
    mgr.currentBidId = bidderId.toString();
    mgr.shouldSendEmails = true;

    const col = mgr.findBidderColInBidSheet_(bidderId);
    if (col === -1) throw new Error("Bidder column not found in Bid-Management");

    mgr.currentReceipt = mgr.buildReceipt_(col);
    if (!mgr.currentReceipt.hasWinningItems()) throw new Error("No items won for this bidder");

    mgr.handleEmailDispatch_();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * Bridge function to create a walk-in ticket from the external app.
 */
function apiCreateWalkInTicket(firstName, lastName, email) {
  try {
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
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * Backs up existing sheets and runs the setup over again.
 * Called from the web application frontend App.
 */
function apiSyncBidders() {
  try {
    const activeSpreadSheet = SpreadsheetApp.getActiveSpreadsheet();
    
    // Create timestamp for backups
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
    
    // Backup Bid-Management sheet
    const bidMgmtSheet = activeSpreadSheet.getSheetByName('Bid-Management');
    if (bidMgmtSheet) {
      bidMgmtSheet.setName(`Bid-Management (Backup ${timestamp})`);
      bidMgmtSheet.hideSheet(); // Optional: hides the backup to keep the workspace clean
    }
    
    // Backup Bidder-Numbers sheet
    const bidderNumbersSheet = activeSpreadSheet.getSheetByName('Bidder-Numbers');
    if (bidderNumbersSheet) {
      bidderNumbersSheet.setName(`Bidder-Numbers (Backup ${timestamp})`);
      bidderNumbersSheet.hideSheet(); // Optional
    }

    // Run the setup classes natively directly from your Apps Script infrastructure
    setupBiddersSheet();
    createBidMgmtSheet();

    return { success: true };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}


/**
 * Core Production Entrypoint endpoint used by your AI Studio layout interfaces.
 * Uses updated clean centralized abstraction models.
 */
function apiCreateIndividualReceipt(bidderId, emailReceipt) {
  try {
    const mgr = new ReceiptManager();
    mgr.currentBidId = bidderId.toString();
    
    const col = mgr.findBidderColInBidSheet_(mgr.currentBidId);
    if (col === -1) return { success: false, error: "Bidder ID not found." };
    
    mgr.currentReceipt = mgr.buildReceipt_(col);
    if (!mgr.currentReceipt.hasWinningItems()) return { success: false, error: "No items won." };
    
    // Call our newly streamlined method wrapper
    const paypal = new PayPalService();
    const paymentUrl = paypal.createInvoiceForReceipt(mgr.currentReceipt, bidderId);
    
    // Store url back onto local manager instance context for QR mapping pipelines
    mgr.customPaymentUrl = paymentUrl;

    if (emailReceipt === true) {
      mgr.handleEmailDispatch_();
    }

    // Process output documents
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
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
