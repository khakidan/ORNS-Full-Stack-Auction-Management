/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * Encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction tickets system architecture.
 */
class GoogleAIStudio {
    constructor ( overrides = {} ) {
        this.bidderManager = overrides.bidderManager || new BidderManager();
    }

    /**
    * Creates the Bidder Labels document from the Avery 5264 template.
    * Bidders are fetched and validated against the Bid-Management app's
    * Bidder-Numbers sheet BEFORE the template is copied, so a hard error
    * (e.g. unmatched bidders) never leaves an orphaned empty doc in Drive.
    * @param {string|null} folderID  Drive folder ID passed in from the API call.
    * @param {string} bidManagementSpreadsheetId  Bid-Management spreadsheet ID,
    *   the source of truth for real bidder numbers.
    * @returns {{ success: boolean, message: string, docId: string, docUrl: string }}
    */
    createBidderLabels ( folderID = null, bidManagementSpreadsheetId = null ) {
        const bidders = this.bidderManager.getAllBidders( bidManagementSpreadsheetId );
        const generator = new BidderLabelsDoc( bidders, folderID );
        generator.generateBidderLabels();

        const docId = generator.docID;
        let docUrl = '';
        try {
            docUrl = DocumentApp.openById( docId ).getUrl();
        } catch ( e ) {
            // Non-fatal — URL retrieval may lag behind Drive propagation
        }

        return {
            success: true,
            message: 'Bidder Labels document created successfully.',
            docId: docId,
            docUrl: docUrl
        };
    }
}

// ── Public-facing bridge functions ────────────────────────────────────────────
// These wrapper names must remain stable — they are called directly by Google AI Studio.

function apiCreateBidderLabels ( folderID, bidManagementSpreadsheetId ) {
    try {
        return new GoogleAIStudio().createBidderLabels( folderID, bidManagementSpreadsheetId );
    } catch ( e ) {
        console.error( 'apiCreateBidderLabels Error: ' + e.toString() );
        return { success: false, error: e.toString() };
    }
}