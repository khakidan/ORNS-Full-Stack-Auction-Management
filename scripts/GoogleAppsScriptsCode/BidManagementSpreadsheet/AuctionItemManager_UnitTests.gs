/**
 * REAL unit tests for Class_AuctionItemManager.gs's `getItemName` -
 * runnable from the Apps Script editor (select `runAuctionItemManagerUnitTests`
 * in the function dropdown and run).
 *
 * This used to read a local, one-time-snapshot copy of the Items
 * spreadsheet living inside Bid Management (3 columns, Active-only,
 * written once by "Set Up Bid Management App" and never updated again),
 * so an item added, renamed, or deactivated afterward silently never
 * showed up on printed receipts or PayPal invoice line items. It now
 * opens the real Auction Items spreadsheet live by ID instead - see
 * docs/agents/refactor-opportunities.md's Code Hardening item #1 and
 * CHANGELOG.md for the full history. The equivalent Node/Vitest suite is
 * server/test/gs-bidmanagement-auction-item-manager.test.ts (loads this
 * exact .gs source via a Node vm sandbox, not a reimplementation).
 *
 * Reuses the assert helpers (paypalTests_assertEqual_/paypalTests_assertThrows_)
 * from PayPalService_UnitTests.gs - that file must exist in the project.
 *
 * Everything here is faked (a fake items spreadsheet), so this never
 * touches a real sheet and is safe to run at any time, including against
 * production data.
 */

// ── Fake Spreadsheet/Sheet (supports getSheetByName, getSheets() for the
//    first-tab fallback, and the 4-arg getRange(row, col, numRows, numCols)
//    form loadItemNameMap_ uses) ─────────────────────────────────────────

function auctionItemManagerTests_fakeSheet_ ( initialRows ) {
    const data = initialRows.map( function ( row ) { return row.slice(); } );
    return {
        data: data,
        getRange: function ( row, col, numRows, numCols ) {
            const rows = data.slice( row - 1, row - 1 + numRows ).map( function ( r ) {
                const padded = r.slice();
                while ( padded.length < numCols ) padded.push( '' );
                return padded.slice( 0, numCols );
            } );
            return { getValues: function () { return rows; } };
        },
        getLastRow: function () { return data.length; }
    };
}

function auctionItemManagerTests_fakeSpreadsheet_ () {
    const sheets = {};
    const order = [];
    return {
        addSheet: function ( name, rows ) {
            if ( !( name in sheets ) ) order.push( name );
            sheets[ name ] = auctionItemManagerTests_fakeSheet_( rows || [] );
            return sheets[ name ];
        },
        getSheetByName: function ( name ) { return sheets[ name ] || null; },
        getSheets: function () { return order.map( function ( name ) { return sheets[ name ]; } ); }
    };
}

// Items-spreadsheet schema (Class_AuctionItem.gs): id, category, name, ...
const AUCTION_ITEM_MANAGER_TESTS_ITEMS_ROWS = [
    [ 'Item Number', 'Category', 'Item Name', 'Description', 'Value', 'Opening Bid', 'Min Raise', 'Donated By', 'Physical/Cert', 'Status', 'Bundle ID', 'Bundled Date/Time' ],
    [ '801', 'Food', 'Pizza Night', 'A pizza dinner', '$50.00', '$22.50', '$5.00', "Joe's Pizza", 'Certificate', 'Active', '', '' ],
    [ '1503', 'Raffle', 'One 50/50 Raffle Ticket $20', '', '', '', '', '', '', 'Active', '', '' ]
];

function auctionItemManagerTests_fakeItemsSpreadsheet_ ( rows, sheetName ) {
    const ss = auctionItemManagerTests_fakeSpreadsheet_();
    ss.addSheet( sheetName || 'Auction-Items', rows || AUCTION_ITEM_MANAGER_TESTS_ITEMS_ROWS );
    return ss;
}

function auctionItemManagerTests_makeManager_ ( itemsSpreadsheet, config ) {
    return new AuctionItemManager( {
        activeSpreadSheet: auctionItemManagerTests_fakeSpreadsheet_(),
        config: config || { auctionImportSheetID: 'items-ss-id' },
        itemsSpreadsheet: itemsSpreadsheet || auctionItemManagerTests_fakeItemsSpreadsheet_()
    } );
}

// ── Tests ─────────────────────────────────────────────────────────────────

function auctionItemManagerTests_looksUpRealItem_ () {
    const manager = auctionItemManagerTests_makeManager_();
    paypalTests_assertEqual_( manager.getItemName( '801' ), 'Pizza Night', 'a real item ID must resolve to its real name from the live Items spreadsheet' );
}

function auctionItemManagerTests_normalizesNumericId_ () {
    const manager = auctionItemManagerTests_makeManager_();
    paypalTests_assertEqual_( manager.getItemName( 1503 ), 'One 50/50 Raffle Ticket $20', 'a numeric ID must normalize the same way as a string ID' );
}

function auctionItemManagerTests_unknownIdFallback_ () {
    const manager = auctionItemManagerTests_makeManager_();
    paypalTests_assertEqual_( manager.getItemName( '9999' ), 'Unknown Item', 'an ID missing from a successfully-read Items spreadsheet must fall back to Unknown Item, not throw' );
}

function auctionItemManagerTests_fallsBackToFirstTab_ () {
    const ss = auctionItemManagerTests_fakeItemsSpreadsheet_( AUCTION_ITEM_MANAGER_TESTS_ITEMS_ROWS, 'Imported Items' );
    const manager = auctionItemManagerTests_makeManager_( ss );
    paypalTests_assertEqual_( manager.getItemName( '801' ), 'Pizza Night', 'when no sheet is named Auction-Items, the workbook\'s first tab must be used' );
}

function auctionItemManagerTests_throwsOnMissingSpreadsheetId_ () {
    // Deliberately no itemsSpreadsheet override and no auctionImportSheetID
    // in config - constructed directly (not via the shared helper, which
    // always substitutes a fake items spreadsheet when none is given).
    const manager = new AuctionItemManager( {
        activeSpreadSheet: auctionItemManagerTests_fakeSpreadsheet_(),
        config: {}
    } );
    paypalTests_assertThrows_( function () { manager.getItemName( '801' ); }, 'Missing the Auction Items spreadsheet ID', 'a missing auctionImportSheetID must throw a clear, actionable error' );
}

function auctionItemManagerTests_throwsOnEmptyCrossRead_ () {
    const ss = auctionItemManagerTests_fakeItemsSpreadsheet_( [ [ 'Item Number', 'Category', 'Item Name' ] ] );
    const manager = auctionItemManagerTests_makeManager_( ss );
    paypalTests_assertThrows_( function () { manager.getItemName( '801' ); }, 'no item data', 'a successfully-opened but empty Items spreadsheet must throw, not silently return Unknown Item for every lookup' );
}

function auctionItemManagerTests_cachesAfterFirstLookup_ () {
    const ss = auctionItemManagerTests_fakeItemsSpreadsheet_();
    const manager = auctionItemManagerTests_makeManager_( ss );

    manager.getItemName( '801' );
    ss.getSheetByName( 'Auction-Items' ).data[ 1 ][ 2 ] = 'Renamed Item';

    paypalTests_assertEqual_( manager.getItemName( '801' ), 'Pizza Night', 'the name map must be cached after the first lookup, not re-read from the spreadsheet on every call' );
}

// ── Runner ────────────────────────────────────────────────────────────────

function runAuctionItemManagerUnitTests () {
    const cases = [
        [ 'looks up a real item\'s name from the live Items spreadsheet', auctionItemManagerTests_looksUpRealItem_ ],
        [ 'normalizes a numeric-looking ID the same way as a string ID', auctionItemManagerTests_normalizesNumericId_ ],
        [ 'returns Unknown Item for an ID missing from a successful read', auctionItemManagerTests_unknownIdFallback_ ],
        [ 'falls back to the workbook\'s first tab when no Auction-Items sheet exists', auctionItemManagerTests_fallsBackToFirstTab_ ],
        [ 'throws when auctionImportSheetID is missing', auctionItemManagerTests_throwsOnMissingSpreadsheetId_ ],
        [ 'throws when the cross-read comes back empty', auctionItemManagerTests_throwsOnEmptyCrossRead_ ],
        [ 'caches the name map after the first lookup', auctionItemManagerTests_cachesAfterFirstLookup_ ]
    ];

    let passed = 0;
    const failures = [];

    cases.forEach( function ( entry ) {
        const name = entry[ 0 ];
        const fn = entry[ 1 ];
        try {
            fn();
            console.log( `✅ PASS  ${ name }` );
            passed++;
        } catch ( e ) {
            console.log( `❌ FAIL  ${ name }` );
            console.log( `   ${ e.message.replace( /\n/g, '\n   ' ) }` );
            failures.push( name );
        }
    } );

    console.log( `\n${ passed }/${ cases.length } test groups passed.` );
    if ( failures.length > 0 ) {
        console.log( `Failed: ${ failures.join( ', ' ) }` );
    }
}
