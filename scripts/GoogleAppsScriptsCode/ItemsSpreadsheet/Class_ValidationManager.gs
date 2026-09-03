/**
 * Data manager. Extends AuctionItemManager so it has access to the
 * Auction-Items sheet data.
 *
 * Responsible for:
 *   - Maintaining the master category list (as AuctionCategory instances)
 *   - Creating / populating the Categories helper sheet
 *   - Assigning sequential item IDs to every row of Auction-Items
 */
class ValidationManager extends AuctionItemManager {
    constructor () {
        super();

        this.categoryString = 'Categories';
        this.headerRow = [ 'Name', 'Slug', 'Base Number' ];

        // Master category list — each entry becomes an AuctionCategory instance
        this.categories = [
            new AuctionCategory( 'Classroom Art', 'class-art', 101 ),
            new AuctionCategory( 'Arts, Crafts and Jewelry', 'arts-craft-jewelry', 201 ),
            new AuctionCategory( 'Health & Beauty', 'health-beauty', 301 ),
            new AuctionCategory( 'Fitness', 'fitness', 401 ),
            new AuctionCategory( 'Kids Activities', 'kids-activities', 501 ),
            new AuctionCategory( 'Retail', 'retail', 601 ),
            new AuctionCategory( 'Entertainment & Experiences', 'entertainment-experiences', 701 ),
            new AuctionCategory( 'Food', 'food', 801 ),
            new AuctionCategory( 'Services', 'services', 901 ),
            new AuctionCategory( 'Classroom Baskets', 'class-baskets', 1001 ),
            new AuctionCategory( 'Travel', 'travel', 1101 ),
            new AuctionCategory( 'Sports Memorabilia & Tickets', 'sports-and-tickets', 1201 ),
            new AuctionCategory( 'Live', 'live', 1301 ),
            new AuctionCategory( 'Movie Night', 'movie-night', 1401 ),
            new AuctionCategory( 'Raffle Tickets', 'raffle-tickets', 1501 ),
            new AuctionCategory( 'Open Appeal', 'open-appeal', 1601 )
        ];
    }

    /**
     * Lazy-loads and caches the Categories sheet data.
     */
    get categoryInfo () {
        if ( this._categoryItems ) return this._categoryItems;

        const sheet = this.activeSpreadSheet.getSheetByName( this.categoryString )
            || this.createCategorySheet();

        const lastRow = sheet.getLastRow();
        const lastCol = sheet.getLastColumn() || 1;
        const dataRange = lastRow > 1
            ? sheet.getRange( 2, 1, lastRow - 1, lastCol ).getValues()
            : [];

        this._categoryItems = {
            sheet,
            lastRow,
            lastCol,
            range: dataRange,
            loopLength: Math.max( 0, lastRow - 1 )
        };
        return this._categoryItems;
    }

    /** Creates the Categories sheet with a frozen header row. */
    createCategorySheet () {
        const sheet = this.activeSpreadSheet.insertSheet( this.categoryString );
        sheet.getRange( 1, 1, 1, this.headerRow.length ).setValues( [ this.headerRow ] );
        sheet.setFrozenRows( 1 );
        return sheet;
    }

    /** Batch-writes all categories to the Categories sheet. */
    populateCategorySheet () {
        const values = this.categories.map( cat => [ cat.name, cat.slug, cat.baseNumber ] );
        this.categoryInfo.sheet.getRange( 2, 1, values.length, 3 ).setValues( values );
    }

    /**
     * Batch-assigns sequential item IDs to every row of the Auction-Items sheet
     * based on the category of each item.
     */
    setAuctionIDsOnItems () {
        const updatedIDs = [];
        for ( let i = 0; i < this.auctionItems.loopLength; i++ ) {
            updatedIDs.push( [ this.findMatchingCategoryValue_( i ) ] );
        }
        if ( updatedIDs.length > 0 ) {
            this.auctionItems.sheet.getRange( 2, 1, updatedIDs.length, 1 ).setValues( updatedIDs );
        }
    }

    /**
     * Returns the next sequential ID for the category of item at index i.
     * Falls back to the existing ID if no matching category is found.
     * @param {number} i
     * @returns {number|string}
     */
    findMatchingCategoryValue_ ( i ) {
        const itemCategory = this.auctionItems.range[ i ][ 1 ];
        for ( let j = 0; j < this.categoryInfo.loopLength; j++ ) {
            if ( itemCategory === this.categoryInfo.range[ j ][ 0 ] ) {
                return this.categories[ j ].getNextId();
            }
        }
        return this.auctionItems.range[ i ][ 0 ]; // Keep existing ID on no match
    }
}

function fixEmptyCategorySheet () { new ValidationManager().populateCategorySheet(); }
function setAuctionIDsOnImportSheet () { new ValidationManager().setAuctionIDsOnItems(); }