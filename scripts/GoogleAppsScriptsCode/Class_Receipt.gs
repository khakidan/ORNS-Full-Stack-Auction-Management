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
}