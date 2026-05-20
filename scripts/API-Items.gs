/**
 * 
 * Add this file to your Google Spreadsheet Apps Script project.
 * It provides bridge functions that can be called by the web application
 * via the Apps Script API.
 */

/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * Encapsulates all bridge functions and the print-folder override helper into a
 * clean, object-oriented structure matching the rest of the auction item entry
 * system architecture.
 */
class GoogleAIStudio {
    constructor() {
        // Initialization hook ready for future instance contexts
    }

    /**
     * Overrides getAuctionSoftwareDevFolder() on a generator instance to redirect
     * output to the 'forPrintFolderID' folder when one is configured in _Settings.
     * Called internally before every generator's produce method.
     * @param {DocService} service  Any Document Generator instance.
     * @private
     */
    setupForPrintOverride_(service) {
        const forPrintId = service.config['forPrintFolderID'];
        console.log('setupForPrintOverride_: forPrintFolderID = ' + forPrintId);
        if (forPrintId && forPrintId.trim() !== '' && !forPrintId.toString().includes('PASTE')) {
            try {
                const folder = DriveApp.getFolderById(forPrintId);
                service.getAuctionSoftwareDevFolder = function() { return folder; };
                console.log('Successfully overrode auction folder with: ' + forPrintId);
            } catch (e) {
                console.error('Failed to override auction folder with ID: ' + forPrintId + '. Error: ' + e.toString());
            }
        }
    }

    /**
     * Creates the bundling meeting document listing all auction items.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createBundlingDoc() {
        const itemManager = new AuctionItemManager();
        const generator   = new BundlingMeetingDoc('Items Up For Auction', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateBundlingDoc();
        return { success: true, message: 'Bundling document created successfully.' };
    }

    /**
     * Creates the auction item packaging labels document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createItemLabels() {
        const itemManager = new AuctionItemManager();
        const generator   = new PackagingLabelsDoc(itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateLabels();
        return { success: true, message: 'Item labels created successfully.' };
    }

    /**
     * Creates the live auction slideshow presentation.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createSlideshow() {
        const itemManager = new AuctionItemManager();
        const generator   = new LiveAuctionSlides(itemManager);
        this.setupForPrintOverride_(generator);
        generator.generatePresentation();
        return { success: true, message: 'Live auction slideshow created successfully.' };
    }

    /**
     * Creates the Bidding Guide cover page document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createBiddingGuideCoverPage() {
        const itemManager = new AuctionItemManager();
        const generator   = new BiddingGuideDoc('Auction Bidding Guide Cover Page', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateCoverPage();
        return { success: true, message: 'Cover page created successfully.' };
    }

    /**
     * Creates the Bidding Guide inner pages document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createBiddingGuideInnerPages() {
        const itemManager = new AuctionItemManager();
        const generator   = new BiddingGuideDoc('Auction Bidding Guide Inner Pages', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateInnerPages();
        return { success: true, message: 'Inner pages created successfully.' };
    }

    /**
     * Creates the bid sheets document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createBidSheets() {
        const itemManager = new AuctionItemManager();
        const generator   = new BidSheetDoc('Bid Sheets', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateBidSheets();
        return { success: true, message: 'Bid sheets created successfully.' };
    }

    /**
     * Creates the auction catalog document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createCatalog() {
        const itemManager = new AuctionItemManager();
        const generator   = new CatalogDoc('Auction Catalog', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateCatalog();
        return { success: true, message: 'Auction catalog created successfully.' };
    }

    /**
     * Creates the table tents document.
     * @returns {{ success: boolean, message?: string, error?: string }}
     */
    createTableTents() {
        const itemManager = new AuctionItemManager();
        const generator   = new TableTentDoc('Table Tents', itemManager);
        this.setupForPrintOverride_(generator);
        generator.generateTableTents();
        return { success: true, message: 'Table tents created successfully.' };
    }
}

// ── Public-facing bridge functions ────────────────────────────────────────────
// These wrapper names must remain stable — they are called directly by Google AI Studio.

function apiCreateBundlingDoc(spreadsheetId) {
    try {
        return new GoogleAIStudio().createBundlingDoc();
    } catch (e) {
        console.error('apiCreateBundlingDoc Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateItemLabels(spreadsheetId) {
    try {
        return new GoogleAIStudio().createItemLabels();
    } catch (e) {
        console.error('apiCreateItemLabels Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateSlideshow(spreadsheetId) {
    try {
        return new GoogleAIStudio().createSlideshow();
    } catch (e) {
        console.error('apiCreateSlideshow Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateBiddingGuideCoverPage(spreadsheetId) {
    try {
        return new GoogleAIStudio().createBiddingGuideCoverPage();
    } catch (e) {
        console.error('apiCreateBiddingGuideCoverPage Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateBiddingGuideInnerPages(spreadsheetId) {
    try {
        return new GoogleAIStudio().createBiddingGuideInnerPages();
    } catch (e) {
        console.error('apiCreateBiddingGuideInnerPages Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateBidSheets(spreadsheetId) {
    try {
        return new GoogleAIStudio().createBidSheets();
    } catch (e) {
        console.error('apiCreateBidSheets Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateCatalog(spreadsheetId) {
    try {
        return new GoogleAIStudio().createCatalog();
    } catch (e) {
        console.error('apiCreateCatalog Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}

function apiCreateTableTents(spreadsheetId) {
    try {
        return new GoogleAIStudio().createTableTents();
    } catch (e) {
        console.error('apiCreateTableTents Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}