/**
 * * Add this file to your Google Spreadsheet Apps Script project.
 * It provides bridge functions that can be called by the web application
 * via the Apps Script API.
 */

class GoogleAIStudio {
    /**
     * @param {Object} [overrides] Optional dependency injection, used by unit
     *   tests. `itemManager` replaces the lazily-constructed
     *   `new AuctionItemManager()` outright, letting tests supply one built
     *   from a fake sheet without needing a real spreadsheet at all.
     *   Production call sites (`new GoogleAIStudio()`) never pass this.
     */
    constructor ( overrides = {} ) {
        this._itemManager = overrides.itemManager || null;
    }

    /**
     * Lazy-loaded getter for the item manager.
     */
    get itemManager () {
        if ( !this._itemManager ) {
            this._itemManager = new AuctionItemManager();
        }
        return this._itemManager;
    }

    /**
     * Centralized runner that handles execution, logging, and error handling.
     * @param {Function} generateAction - Callback containing the generation call.
     * @param {string}   successMessage
     * @param {string}   errorLogLabel
     * @returns {Object} Standardized API response
     */
    _executeGeneration ( generateAction, successMessage, errorLogLabel ) {
        try {
            generateAction();
            return { success: true, message: successMessage };
        } catch ( e ) {
            console.error( `${ errorLogLabel } Error: ${ e.toString() }` );
            return { success: false, error: e.toString() };
        }
    }

    /**
     * @param {string|null} folderID  Drive folder ID passed in from the API call.
     * @returns {Object}
     */
    createBundlingDoc ( folderID = null ) {
        const generator = new BundlingMeetingDoc( 'Items Up For Auction', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateBundlingDoc(),
            'Bundling document created successfully.',
            'createBundlingDoc'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createItemLabels ( folderID = null ) {
        const generator = new PackagingLabelsDoc( this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateLabels(),
            'Item labels created successfully.',
            'createItemLabels'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createSlideshow ( folderID = null ) {
        const generator = new LiveAuctionSlides( this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generatePresentation(),
            'Live auction slideshow created successfully.',
            'createSlideshow'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createBiddingGuideCoverPage ( folderID = null ) {
        const generator = new BiddingGuideDoc( 'Auction Bidding Guide Cover Page', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateCoverPage(),
            'Cover page created successfully.',
            'createBiddingGuideCoverPage'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createBiddingGuideInnerPages ( folderID = null ) {
        const generator = new BiddingGuideDoc( 'Auction Bidding Guide Inner Pages', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateInnerPages(),
            'Inner pages created successfully.',
            'createBiddingGuideInnerPages'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createBidSheets ( folderID = null ) {
        const generator = new BidSheetDoc( 'Bid Sheets', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateBidSheets(),
            'Bid sheets created successfully.',
            'createBidSheets'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createCatalog ( folderID = null ) {
        const generator = new CatalogDoc( 'Auction Catalog', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateCatalog(),
            'Auction catalog created successfully.',
            'createCatalog'
        );
    }

    /**
     * @param {string|null} folderID
     * @returns {Object}
     */
    createTableTents ( folderID = null ) {
        const generator = new TableTentDoc( 'Table Tents', this.itemManager, folderID );
        return this._executeGeneration(
            () => generator.generateTableTents(),
            'Table tents created successfully.',
            'createTableTents'
        );
    }
}

// ==============================================================================
// GLOBAL API WRAPPERS
// Pass folderID as the first argument when calling via the Apps Script API.
// Example from Google AI Studio: run("apiCreateBundlingDoc", ["your-folder-id-here"])
// ==============================================================================

const API_BRIDGE = new GoogleAIStudio();

function apiCreateBundlingDoc ( folderID ) { return API_BRIDGE.createBundlingDoc( folderID ); }
function apiCreateItemLabels ( folderID ) { return API_BRIDGE.createItemLabels( folderID ); }
function apiCreateSlideshow ( folderID ) { return API_BRIDGE.createSlideshow( folderID ); }
function apiCreateBiddingGuideCoverPage ( folderID ) { return API_BRIDGE.createBiddingGuideCoverPage( folderID ); }
function apiCreateBiddingGuideInnerPages ( folderID ) { return API_BRIDGE.createBiddingGuideInnerPages( folderID ); }
function apiCreateBidSheets ( folderID ) { return API_BRIDGE.createBidSheets( folderID ); }
function apiCreateCatalog ( folderID ) { return API_BRIDGE.createCatalog( folderID ); }
function apiCreateTableTents ( folderID ) { return API_BRIDGE.createTableTents( folderID ); }