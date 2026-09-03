/**
 * Data model for a single bidder.
 * Constructed with a display name and a pre-assigned bidder number.
 * Has no knowledge of sheets, docs, or UI.
 */
class Bidder {
    /**
     * @param {string} name    Full display name (e.g., "Jane Smith").
     * @param {number} [number=0]  The assigned bidder number.
     */
    constructor ( name, number = 0 ) {
        this.name = name;
        this.number = number;
    }

    getDisplayName () { return this.name; }
    getNumber () { return this.number.toString(); }
    setNumber ( n ) { this.number = n; }
}