/**
 * Data model for a single auction item row.
 * The Bid-Management version of this model only needs id and name
 * (the full catalog details live in the Item Entry script).
 */
class AuctionItem {
    /**
     * @param {string|number} id
     * @param {string}        name
     */
    constructor ( id, name ) {
        this.id = id.toString();
        this.name = name;
    }

    getId () { return this.id; }
    getName () { return this.name; }
}