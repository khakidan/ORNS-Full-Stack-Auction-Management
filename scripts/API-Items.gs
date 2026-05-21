/**
 * 
 * Add this file to your Google Spreadsheet Apps Script project.
 * It provides bridge functions that can be called by the web application
 * via the Apps Script API.
 */

class GoogleAIStudio {
  constructor() {
      this._itemManager = null;
  }

  /**
   * Lazy-loaded getter for the item manager.
   * It only initializes the manager the very first time it's called.
   */
  get itemManager() {
      if (!this._itemManager) {
          this._itemManager = new AuctionItemManager();
      }
      return this._itemManager;
  }

  /**
   * Centralized runner that handles the setup, execution, logging, and error handling
   * for all document generation tasks.
   * * @param {Object} generator - The document generator class instance.
   * @param {Function} generateAction - Callback function containing the generation call.
   * @param {string} successMessage - Message to return on success.
   * @param {string} errorLogLabel - Label used for error logging.
   * @returns {Object} Standardized API response
   */
  _executeGeneration(generator, generateAction, successMessage, errorLogLabel) {
      try {
          this.setupForPrintOverride(generator);
          
          // Execute the unique function passed in for this document
          generateAction();
          
          return {
             success: true,
              message: successMessage
          };
      } catch (e) {
          console.error(`${errorLogLabel} Error: ${e.toString()}`);
          return {
             success: false,
             error: e.toString()
          };
      }
  }

  /**
   * Helper to ensure the files go to the "For Print" folder if configured.
   * It temporarily overrides the getAuctionSoftwareDevFolder method.
   * * @param {Object} service - The document generator instance.
   */
  setupForPrintOverride(service) {
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
   * Triggers the bundling document generation.
   * @returns {Object} Success or error response
   */
  createBundlingDoc() {
      const generator = new BundlingMeetingDoc('Items Up For Auction', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateBundlingDoc(), 
          'Bundling document created successfully.', 
          'createBundlingDoc'
      );
  }

  /**
   * Creates item labels.
   * @returns {Object} Success or error response
   */
  createItemLabels() {
      const generator = new PackagingLabelsDoc(this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateLabels(), 
          'Item labels created successfully.', 
          'createItemLabels'
      );
  }

  /**
   * Creates the live auction slideshow.
   * @returns {Object} Success or error response
   */
  createSlideshow() {
      const generator = new LiveAuctionSlides(this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generatePresentation(), 
          'Live auction slideshow created successfully.', 
          'createSlideshow'
      );
  }

  /**
   * Creates the Bidding Guide Cover Page.
   * @returns {Object} Success or error response
   */
  createBiddingGuideCoverPage() {
      const generator = new BiddingGuideDoc('Auction Bidding Guide Cover Page', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateCoverPage(), 
          'Cover page created successfully.', 
          'createBiddingGuideCoverPage'
      );
  }

  /**
   * Creates the Bidding Guide Inner Pages.
   * @returns {Object} Success or error response
   */
  createBiddingGuideInnerPages() {
      const generator = new BiddingGuideDoc('Auction Bidding Guide Inner Pages', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateInnerPages(), 
          'Inner pages created successfully.', 
          'createBiddingGuideInnerPages'
      );
  }

  /**
   * Creates the Bid Sheets.
   * @returns {Object} Success or error response
   */
  createBidSheets() {
      const generator = new BidSheetDoc('Bid Sheets', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateBidSheets(), 
          'Bid sheets created successfully.', 
          'createBidSheets'
      );
  }

  /**
   * Creates the Auction Catalog.
   * @returns {Object} Success or error response
   */
  createCatalog() {
      const generator = new CatalogDoc('Auction Catalog', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateCatalog(), 
          'Auction catalog created successfully.', 
          'createCatalog'
      );
  }

  /**
   * Creates the Table Tents.
   * @returns {Object} Success or error response
   */
  createTableTents() {
      const generator = new TableTentDoc('Table Tents', this.itemManager);
      return this._executeGeneration(
          generator, 
          () => generator.generateTableTents(), 
          'Table tents created successfully.', 
          'createTableTents'
      );
  }
}

// ==============================================================================
// GLOBAL API WRAPPERS (Required for Google Apps Script execution via external API)
// ==============================================================================

const API_BRIDGE = new GoogleAIStudio();

function apiCreateBundlingDoc() {
  return API_BRIDGE.createBundlingDoc();
}

function apiCreateItemLabels() {
  return API_BRIDGE.createItemLabels();
}

function apiCreateSlideshow() {
  return API_BRIDGE.createSlideshow();
}

function apiCreateBiddingGuideCoverPage() {
  return API_BRIDGE.createBiddingGuideCoverPage();
}

function apiCreateBiddingGuideInnerPages() {
  return API_BRIDGE.createBiddingGuideInnerPages();
}

function apiCreateBidSheets() {
  return API_BRIDGE.createBidSheets();
}

function apiCreateCatalog() {
  return API_BRIDGE.createCatalog();
}

function apiCreateTableTents() {
  return API_BRIDGE.createTableTents();
}