/**
 * API for Auction Tickets Spreadsheet
 * Add this to your Auction Tickets Spreadsheet's Apps Script project.
 */

/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * Encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction tickets system architecture.
 */
class GoogleAIStudio {
    constructor() {
        // Initialization hook ready for future instance contexts
    }

    /**
     * Creates the Bidder Labels document from the Avery 5264 template.
     * @returns {{ success: boolean, message: string, docId: string, docUrl: string }}
     */
    createBidderLabels() {
        const bidderManager = new BidderManager();
        const generator     = new BidderLabelsDoc(bidderManager);
        generator.generateBidderLabels();

        const docId = generator.docID;
        let docUrl  = '';
        try {
            docUrl = DocumentApp.openById(docId).getUrl();
        } catch (e) {
            // Non-fatal — URL retrieval may lag behind Drive propagation
        }

        return {
            success: true,
            message: 'Bidder Labels document created successfully.',
            docId:   docId,
            docUrl:  docUrl
        };
    }
}

// ── Public-facing bridge functions ────────────────────────────────────────────
// These wrapper names must remain stable — they are called directly by Google AI Studio.

function apiCreateBidderLabels() {
    try {
        return new GoogleAIStudio().createBidderLabels();
    } catch (e) {
        console.error('apiCreateBidderLabels Error: ' + e.toString());
        return { success: false, error: e.toString() };
    }
}