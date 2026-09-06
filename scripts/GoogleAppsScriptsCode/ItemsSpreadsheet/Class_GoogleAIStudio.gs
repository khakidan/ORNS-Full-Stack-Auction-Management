/**
 * * Add this file to your Google Spreadsheet Apps Script project.
 * It provides bridge functions that can be called by the web application
 * via the Apps Script API.
 */

class GoogleAIStudio {
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
     * @param {Object[]}    items     Already-resolved, valid/sorted item data -
     *   see server/services/itemDataService.ts's getValidSortedItems. Node
     *   resolves this itself now instead of this class looking it up - see
     *   docs/agents/refactor-opportunities.md's Code Hardening item #3 /
     *   CHANGELOG.md.
     * @returns {Object}
     */
    createBundlingDoc ( folderID = null, items = [] ) {
        const generator = new BundlingMeetingDoc( 'Items Up For Auction', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateBundlingDoc(),
            'Bundling document created successfully.',
            'createBundlingDoc'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createItemLabels ( folderID = null, items = [] ) {
        const generator = new PackagingLabelsDoc( items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateLabels(),
            'Item labels created successfully.',
            'createItemLabels'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createSlideshow ( folderID = null, items = [] ) {
        const generator = new LiveAuctionSlides( items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generatePresentation(),
            'Live auction slideshow created successfully.',
            'createSlideshow'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createBiddingGuideCoverPage ( folderID = null, items = [] ) {
        const generator = new BiddingGuideDoc( 'Auction Bidding Guide Cover Page', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateCoverPage(),
            'Cover page created successfully.',
            'createBiddingGuideCoverPage'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createBiddingGuideInnerPages ( folderID = null, items = [] ) {
        const generator = new BiddingGuideDoc( 'Auction Bidding Guide Inner Pages', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateInnerPages(),
            'Inner pages created successfully.',
            'createBiddingGuideInnerPages'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createBidSheets ( folderID = null, items = [] ) {
        const generator = new BidSheetDoc( 'Bid Sheets', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateBidSheets(),
            'Bid sheets created successfully.',
            'createBidSheets'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createCatalog ( folderID = null, items = [] ) {
        const generator = new CatalogDoc( 'Auction Catalog', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateCatalog(),
            'Auction catalog created successfully.',
            'createCatalog'
        );
    }

    /**
     * @param {string|null} folderID
     * @param {Object[]}    items
     * @returns {Object}
     */
    createTableTents ( folderID = null, items = [] ) {
        const generator = new TableTentDoc( 'Table Tents', items.map( AuctionItem.fromData ), folderID );
        return this._executeGeneration(
            () => generator.generateTableTents(),
            'Table tents created successfully.',
            'createTableTents'
        );
    }
}

// ==============================================================================
// GLOBAL API WRAPPERS
// Pass folderID and the resolved items array as arguments when calling via
// the Apps Script API. Example from Node: run("apiCreateBundlingDoc",
// [folderID, items])
// ==============================================================================

const API_BRIDGE = new GoogleAIStudio();

function apiCreateBundlingDoc ( folderID, items ) { return API_BRIDGE.createBundlingDoc( folderID, items ); }
function apiCreateItemLabels ( folderID, items ) { return API_BRIDGE.createItemLabels( folderID, items ); }
function apiCreateSlideshow ( folderID, items ) { return API_BRIDGE.createSlideshow( folderID, items ); }
function apiCreateBiddingGuideCoverPage ( folderID, items ) { return API_BRIDGE.createBiddingGuideCoverPage( folderID, items ); }
function apiCreateBiddingGuideInnerPages ( folderID, items ) { return API_BRIDGE.createBiddingGuideInnerPages( folderID, items ); }
function apiCreateBidSheets ( folderID, items ) { return API_BRIDGE.createBidSheets( folderID, items ); }
function apiCreateCatalog ( folderID, items ) { return API_BRIDGE.createCatalog( folderID, items ); }
function apiCreateTableTents ( folderID, items ) { return API_BRIDGE.createTableTents( folderID, items ); }
