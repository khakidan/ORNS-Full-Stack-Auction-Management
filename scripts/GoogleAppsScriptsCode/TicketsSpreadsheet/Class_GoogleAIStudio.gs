/**
 * Class GoogleAIStudio
 * Handles backend execution pipelines invoked by external applications (e.g., Google AI Studio).
 * Encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction tickets system architecture.
 */
class GoogleAIStudio {
    constructor () {}

    /**
    * Creates the Bidder Labels document from the Avery 5264 template.
    * Bidders are fetched and validated by Node BEFORE this function is even
    * called (Node reads the Bid-Management app's real "Bidder-Numbers"
    * sheet - see server/services/syncService.ts's getBidderLabelList - and
    * passes the finished list straight in), so a hard error there never
    * leaves an orphaned empty doc in Drive here.
    * @param {string|null} folderID  Drive folder ID passed in from the API call.
    * @param {{name: string, number: string}[]} bidders  Already-fetched,
    *   already-matched bidder list, sorted ascending by number.
    * @returns {{ success: boolean, message: string, docId: string, docUrl: string }}
    */
    createBidderLabels ( folderID = null, bidders = [] ) {
        if ( !bidders || bidders.length === 0 ) {
            throw new Error( 'No bidders were provided to generate labels for.' );
        }

        const bidderInstances = bidders.map( b => new Bidder( b.name, b.number ) );
        const generator = new BidderLabelsDoc( bidderInstances, folderID );
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

function apiCreateBidderLabels ( folderID, bidders ) {
    try {
        return new GoogleAIStudio().createBidderLabels( folderID, bidders );
    } catch ( e ) {
        console.error( 'apiCreateBidderLabels Error: ' + e.toString() );
        return { success: false, error: e.toString() };
    }
}