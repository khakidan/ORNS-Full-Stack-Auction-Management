/**
 * Data model for a single auction category.
 * Tracks the sequential base number used to generate item IDs.
 */
class AuctionCategory {
    /**
     * @param {string} name
     * @param {string} slug
     * @param {number} baseNumber  The starting item ID for this category.
     */
    constructor ( name, slug, baseNumber ) {
        this.name = name;
        this.slug = slug;
        this.baseNumber = baseNumber;
    }

    /**
     * Returns the next available ID for this category and advances the counter.
     * @returns {number}
     */
    getNextId () { return this.baseNumber++; }
}