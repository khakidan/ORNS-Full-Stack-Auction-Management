/**
 * API Bridge for Auction Tickets Spreadsheet
 * Add this to your Auction Tickets Spreadsheet's Apps Script project.
 */

/**
 * Bridge function to create Bidder Labels document.
 * This corresponds to the generateBidderLabels() method in the BidderLabelsDoc class.
 * @param {string} spreadsheetId 
 */
function apiCreateBidderLabels(spreadsheetId) {
  try {
    // 1. Instantiate the data manager
    const bidderManager = new BidderManager();
    
    // 2. Instantiate the document generator with the manager
    // The constructor handles creating the document copy from the template.
    const generator = new BidderLabelsDoc(bidderManager);
    
    // 3. Trigger the generation process
    generator.generateBidderLabels();
    
    // 4. Retrieve the ID of the document created by the generator
    // (BidderLabelsDoc inherits docID from DocService/DriveService)
    const docId = generator.docID;
    let docUrl = "";
    
    try {
      docUrl = DocumentApp.openById(docId).getUrl();
    } catch (urlErr) {
       // Non-fatal if we can't get the URL immediately
    }

    return {
      success: true,
      message: 'Bidder Labels Doc created successfully.',
      docId: docId,
      docUrl: docUrl
    };
  } catch (e) {
    console.error('apiCreateBidderLabels Error: ' + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Bridge function for potential future bidding management syncs.
 */
function apiSyncBiddersToMain(spreadsheetId) {
  try {
    // This is a placeholder for the sync logic requested in the UI
    return { 
      success: true, 
      message: "Sync request received. Ready to connect to main management spreadsheet." 
    };
  } catch (e) {
    console.error('apiSyncBiddersToMain Error: ' + e.toString());
    return { success: false, error: e.toString() };
  }
}
