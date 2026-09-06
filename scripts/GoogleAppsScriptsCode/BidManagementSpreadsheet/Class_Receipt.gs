/**
 * Data model for a single winning bidder's receipt.
 * Holds everything needed to write a receipt doc or send an email.
 * No knowledge of sheets, docs, or UI.
 */
class Receipt {
    /**
     * @param {string|number} bidId
     * @param {string} firstName
     * @param {string} lastName
     * @param {string} email
     */
    constructor ( bidId, firstName, lastName, email ) {
        this.bidId = bidId;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
        this.itemsWon = [];   // Array of item IDs
        this.itemNames = [];   // Array of item names (parallel to itemsWon)
        this.itemPrices = [];   // Array of prices (parallel to itemsWon)
        this.totalCost = 0;
    }

    hasWinningItems () { return this.itemsWon.length > 0; }

    getDisplayName () { return `${ this.firstName } ${ this.lastName }`.trim(); }

    /**
     * Adds a single won item to the receipt and updates the running total.
     * @param {string|number} itemId
     * @param {string}        itemName
     * @param {number}        price
     */
    addItem ( itemId, itemName, price ) {
        this.itemsWon.push( itemId );
        this.itemNames.push( itemName );
        this.itemPrices.push( price );
        this.totalCost += ( Number( price ) || 0 );
    }

    /**
     * Reconstructs a Receipt from a plain { bidId, firstName, lastName,
     * email, itemsWon, itemNames, itemPrices, totalCost } object - the
     * shape server/services/receiptDataService.ts's buildBidderReceipt/
     * buildAllBidderReceipts already computed, passed in here as an Apps
     * Script API parameter instead of this class looking any of it up
     * itself. See docs/agents/refactor-opportunities.md's Code Hardening
     * item #2 / CHANGELOG.md.
     * @param {Object} data
     * @returns {Receipt}
     */
    static fromData ( data ) {
        const receipt = new Receipt( data.bidId, data.firstName, data.lastName, data.email );
        receipt.itemsWon = data.itemsWon || [];
        receipt.itemNames = data.itemNames || [];
        receipt.itemPrices = data.itemPrices || [];
        receipt.totalCost = data.totalCost || 0;
        return receipt;
    }
}