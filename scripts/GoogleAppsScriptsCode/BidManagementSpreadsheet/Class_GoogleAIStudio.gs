/**
 * Class GoogleAIStudio
 * Bridge functions the ORNS web app's Node server calls via the Apps Script API
 * (scripts.run). The class name is historical - the app was first built in Google
 * AI Studio - and is kept so the deployed script projects don't need re-pasting.
 * This encapsulates all bridge functions into a clean, object-oriented structure
 * matching the rest of the auction management system architecture.
 */
class GoogleAIStudio extends GlobalVariables { // ◄ Added 'extends GlobalVariables'
    /**
     * @param {Object} [overrides] Optional dependency injection, used by unit
     *   tests - forwarded to `GlobalVariables` (activeSpreadSheet/config).
     *   Production call sites (`new GoogleAIStudio()`) never pass this.
     */
    constructor ( overrides = {} ) {
        super( overrides );
    }

    /**
     * Triggers batch printing layout receipts.
     * @param {string|null} folderID  Drive folder ID passed in from the API call.
     * @param {Object[]} receipts  Already-built receipt data for every
     *   bidder with at least one winning item, sorted ascending by last
     *   name - see server/services/receiptDataService.ts's
     *   buildAllBidderReceipts. Node resolves this itself now instead of
     *   this class looking it up - see
     *   docs/agents/refactor-opportunities.md's Code Hardening item #2 /
     *   CHANGELOG.md.
     * @returns {{success: boolean, error?: string}}
     */
    createAllReceipts ( folderID = null, receipts = [] ) {
        const mgr = new ReceiptManager( folderID ); // ← folderID threaded to ReceiptManager

        const totalRows = receipts.length;
        const midPoint = Math.ceil( totalRows / 2 );

        mgr.processBatch_( 'Receipts - 1st Half', receipts, 0, midPoint );
        mgr.processBatch_( 'Receipts - 2nd Half', receipts, midPoint, totalRows );

        return { success: true };
    }

    /**
     * Clean production pipeline for processing individual external endpoint receipt builds.
     * @param {string|number} bidderId
     * @param {string|null}   folderID  Drive folder ID passed in from the API call.
     * @param {Object|null}   receiptData  Already-built receipt data for
     *   this bidder, including the already-resolved PayPal `paymentUrl`/
     *   `adjustedTotal` - see
     *   server/services/receiptDataService.ts's
     *   buildBidderReceiptWithInvoice. Node resolves this itself now
     *   instead of this class looking it up (and no longer calls
     *   PayPalService at all) - see
     *   docs/agents/refactor-opportunities.md's Code Hardening item #2 /
     *   CHANGELOG.md.
     * @returns {{success: boolean, docId?: string, subtotal?: number, paymentUrl?: string, error?: string}}
     */
    createIndividualReceipt ( bidderId, folderID = null, receiptData = null ) {
        if ( bidderId === null || bidderId === undefined || bidderId.toString().trim() === '' ) {
            return { success: false, error: 'Provided Bidder ID is empty or invalid.' };
        }
        if ( !receiptData ) {
            return { success: false, error: 'No receipt data provided.' };
        }
        if ( !receiptData.paymentUrl ) {
            return { success: false, error: 'No payment URL provided.' };
        }

        const sanitizedId = bidderId.toString().trim();
        const mgr = new ReceiptManager();
        mgr.currentBidId = sanitizedId;
        mgr.currentReceipt = Receipt.fromData( receiptData );

        if ( !mgr.currentReceipt.hasWinningItems() ) return { success: false, error: 'No items won.' };

        const paymentUrl = mgr.currentReceipt.paymentUrl;

        const doc = new ReceiptDoc( folderID ); // ← folderID passed directly to ReceiptDoc
        doc.setDoc_( `${ mgr.currentReceipt.lastName }, ${ mgr.currentReceipt.firstName }` );
        doc.writeHeader_();
        doc.writeReceiptBody_( mgr.currentReceipt, mgr );
        doc.writeFooter_();
        doc.saveAndClose_();
        const newPdfId = doc.convertToPdfAndMove_( true );

        return {
            success: true,
            docId: newPdfId,
            subtotal: mgr.currentReceipt.totalCost,
            paymentUrl: paymentUrl
        };
    }
}

function apiCreateAllReceipts ( folderID, receipts ) {
    try {
        // BUG FIX: this bridge function used to drop `receipts` entirely -
        // it never forwarded it to createAllReceipts, so every real batch
        // call from Node (which always sends a receipts array as the 2nd
        // Apps Script parameter) silently ran with an empty list. See
        // docs/agents/CHANGELOG.md.
        return new GoogleAIStudio().createAllReceipts( folderID, receipts );
    } catch ( e ) {
        return { success: false, error: e.toString() };
    }
}

function apiCreateIndividualReceipt ( bidderId, folderID, receiptData ) {
    try {
        return new GoogleAIStudio().createIndividualReceipt( bidderId, folderID, receiptData );
    } catch ( e ) {
        return { success: false, error: e.toString() };
    }
}