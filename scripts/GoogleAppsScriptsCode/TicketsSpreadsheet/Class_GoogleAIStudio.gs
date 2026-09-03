/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * Encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction tickets system architecture.
 */
class GoogleAIStudio {
    constructor () {
        // Initialization hook ready for future instance contexts
    }

    /**
    * Creates the Bidder Labels document from the Avery 5264 template.
    * @param {string|null} folderID  Drive folder ID passed in from the API call.
    * @returns {{ success: boolean, message: string, docId: string, docUrl: string }}
    */
    createBidderLabels ( folderID = null ) {
        const bidderManager = new BidderManager();
        const generator = new BidderLabelsDoc( bidderManager, folderID );
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

function apiCreateBidderLabels ( folderID ) {
    try {
        return new GoogleAIStudio().createBidderLabels( folderID );
    } catch ( e ) {
        console.error( 'apiCreateBidderLabels Error: ' + e.toString() );
        return { success: false, error: e.toString() };
    }
}