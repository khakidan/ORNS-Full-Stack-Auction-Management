/**
 * APIBridge.gs
 * 
 * Add this file to your Google Spreadsheet Apps Script project.
 * It provides bridge functions that can be called by the web application
 * via the Apps Script API.
 */

/**
 * Helper to ensure the files go to the "For Print" folder if configured.
 * It temporarily overrides the getAuctionSoftwareDevFolder method.
 */
function setupForPrintOverride(service) {
  const forPrintId = service.config['forPrintFolderID'];
  console.log('setupForPrintOverride: forPrintFolderID = ' + forPrintId);
  if (forPrintId && forPrintId.trim() !== '' && !forPrintId.toString().includes('PASTE')) {
    try {
      const folder = DriveApp.getFolderById(forPrintId);
      service.getAuctionSoftwareDevFolder = function() {
        return folder;
      };
      console.log('Successfully overrode auction folder with: ' + forPrintId);
    } catch (e) {
      console.error('Failed to override auction folder with ID: ' + forPrintId + '. Error: ' + e.toString());
    }
  }
}

/**
 * Global function to trigger the bundling document generation.
 * This is called by the React app via the /api/script/run endpoint.
 */
function apiCreateBundlingDoc(spreadsheetId) {
  try {
    const itemManager = new AuctionItemManager();
    const generator = new BundlingMeetingDoc('Items Up For Auction', itemManager);
    setupForPrintOverride(generator);
    generator.generateBundlingDoc();
    
    return {
      success: true,
      message: 'Bundling document created successfully.'
    };
  } catch (e) {
    console.error('apiCreateBundlingDoc Error: ' + e.toString());
    return {
      success: false,
      error: e.toString()
    };
  }
}

/**
 * Bridge for creating item labels.
 */
function apiCreateItemLabels(spreadsheetId) {
  try {
    const itemManager = new AuctionItemManager();
    const generator = new PackagingLabelsDoc(itemManager);
    setupForPrintOverride(generator);
    generator.generateLabels();
    
    return {
      success: true,
      message: 'Item labels created successfully.'
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}

/**
 * Bridge for creating the slideshow.
 */
function apiCreateSlideshow(spreadsheetId) {
  try {
    const itemManager = new AuctionItemManager();
    const generator = new LiveAuctionSlides(itemManager);
    setupForPrintOverride(generator);
    generator.generatePresentation();
    
    return {
      success: true,
      message: 'Live auction slideshow created successfully.'
    };
  } catch (e) {
    return { success: false, error: e.toString() };
  }
}
