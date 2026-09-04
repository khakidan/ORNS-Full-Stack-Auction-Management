/**
 * REAL unit tests for AuctionItemManager.getValidSortedItems, AuctionItem's
 * display-fallback helpers, and GoogleAIStudio._executeGeneration/itemManager
 * override - runnable from the Apps Script editor (select
 * `runItemsSpreadsheetUnitTests` in the function dropdown and run).
 *
 * Everything here is faked (a fake spreadsheet/sheet), so this never
 * touches a real sheet and is safe to run at any time, including against
 * production data.
 *
 * Deliberately NOT covered here: the 8 api* document-generation methods'
 * actual output (createBundlingDoc, createItemLabels, etc.) - each builds
 * a real DocumentApp/SlidesApp/DriveApp-backed document, and faithfully
 * faking those chained builder APIs for 7 different generators was judged
 * not worth the effort versus the safety it would buy. See
 * refactor-opportunities.md.
 *
 * The equivalent Node/Vitest suites (server/test/gs-items-auction-item-manager.test.ts,
 * server/test/gs-items-google-ai-studio.test.ts) run this exact same source
 * file's logic inside this app's own test run - use these editor-run tests
 * when you want to sanity-check the live Apps Script project directly,
 * without a local checkout.
 */

// ── Tiny assertion helpers ───────────────────────────────────────────────

function itemsTests_assertEqual_ ( actual, expected, message ) {
    const a = JSON.stringify( actual );
    const e = JSON.stringify( expected );
    if ( a !== e ) {
        throw new Error( `${ message }\n  Expected: ${ e }\n  Actual:   ${ a }` );
    }
}

function itemsTests_assertThrows_ ( fn, messageMatch, message ) {
    try {
        fn();
    } catch ( e ) {
        if ( messageMatch && e.message.indexOf( messageMatch ) === -1 ) {
            throw new Error( `${ message }\n  Expected error containing: "${ messageMatch }"\n  Actual error: "${ e.message }"` );
        }
        return; // threw as expected
    }
    throw new Error( `${ message }\n  Expected a throw, but the function returned normally.` );
}

// ── Fake Spreadsheet/Sheet ───────────────────────────────────────────────

function itemsTests_fakeSheet_ ( initialRows ) {
    const data = initialRows.map( function ( row ) { return row.slice(); } );
    return {
        data: data,
        getDataRange: function () {
            const snapshot = data.map( function ( row ) { return row.slice(); } );
            return { getValues: function () { return snapshot; } };
        },
        getLastRow: function () { return data.length; },
        getLastColumn: function () {
            return data.reduce( function ( max, row ) { return Math.max( max, row.length ); }, 0 );
        },
        getRange: function ( a, b, numRows, numCols ) {
            if ( typeof a === 'string' ) {
                const stub = {};
                stub.setFontWeight = function () { return stub; };
                stub.setBackground = function () { return stub; };
                return stub;
            }
            if ( numRows !== undefined && numCols !== undefined ) {
                const rows = data.slice( a - 1, a - 1 + numRows ).map( function ( r ) {
                    const padded = r.slice();
                    while ( padded.length < numCols ) padded.push( '' );
                    return padded.slice( 0, numCols );
                } );
                return {
                    getValues: function () { return rows; },
                    setValues: function ( values ) {
                        values.forEach( function ( v, i ) { data[ a - 1 + i ] = v.slice(); } );
                    }
                };
            }
            const row = a;
            const col = b;
            return {
                setValue: function ( v ) { data[ row - 1 ][ col - 1 ] = v; },
                getValue: function () { return data[ row - 1 ] ? data[ row - 1 ][ col - 1 ] : undefined; },
                clearContent: function () { data[ row - 1 ][ col - 1 ] = ''; }
            };
        },
        appendRow: function ( row ) { data.push( row ); }
    };
}

function itemsTests_fakeSpreadsheet_ () {
    const sheets = {};
    return {
        addSheet: function ( name, rows ) {
            sheets[ name ] = itemsTests_fakeSheet_( rows || [] );
            return sheets[ name ];
        },
        getSheetByName: function ( name ) { return sheets[ name ] || null; },
        insertSheet: function ( name ) { return this.addSheet( name, [] ); }
    };
}

// Column layout of an Auction-Items row (0-indexed):
// A id, B category, C name, D description, E value, F openingBid, G minRaise,
// H donatedBy, I phyOrCert, J status, K bundleID, L bundleTimestamp
const ITEMS_TESTS_HEADER = [ 'Item Number', 'Category', 'Item Name', 'Description', 'Value', 'Opening Bid', 'Min Raise', 'Donated By', 'Physical/Cert', 'Status', 'Bundle ID', 'Bundled Date/Time' ];

function itemsTests_itemRow_ ( id, overrides ) {
    const row = [ id, 'Food', `Item ${ id }`, 'A description', '100', '50', '5', 'A Donor', 'Physical Item', 'Active', '', '' ];
    Object.keys( overrides || {} ).forEach( function ( k ) { row[ k ] = overrides[ k ]; } );
    return row;
}

// ── AuctionItemManager.getValidSortedItems ───────────────────────────────

function itemsTests_excludesInactiveAndDeleted_ () {
    const ss = itemsTests_fakeSpreadsheet_();
    ss.addSheet( 'Auction-Items', [
        ITEMS_TESTS_HEADER,
        itemsTests_itemRow_( '101', { 9: 'Active' } ),
        itemsTests_itemRow_( '102', { 9: 'inactive' } ),
        itemsTests_itemRow_( '103', { 9: 'Deleted' } ),
        itemsTests_itemRow_( '104', { 9: '  DELETED  ' } ),
        itemsTests_itemRow_( '105', { 9: '' } )
    ] );
    const mgr = new AuctionItemManager( { activeSpreadSheet: ss, config: {} } );

    const ids = mgr.getValidSortedItems().map( function ( i ) { return i.id; } );
    itemsTests_assertEqual_( ids, [ '101', '105' ], 'should exclude inactive/deleted, case/whitespace-insensitively' );
}

function itemsTests_sortsNumericallyById_ () {
    const ss = itemsTests_fakeSpreadsheet_();
    ss.addSheet( 'Auction-Items', [
        ITEMS_TESTS_HEADER,
        itemsTests_itemRow_( '1301' ),
        itemsTests_itemRow_( '150' ),
        itemsTests_itemRow_( '201' )
    ] );
    const mgr = new AuctionItemManager( { activeSpreadSheet: ss, config: {} } );

    const ids = mgr.getValidSortedItems().map( function ( i ) { return i.id; } );
    itemsTests_assertEqual_( ids, [ '150', '201', '1301' ], 'should sort numerically, not lexicographically' );
}

function itemsTests_emptySheetReturnsNoItems_ () {
    const ss = itemsTests_fakeSpreadsheet_(); // no Auction-Items sheet added
    const mgr = new AuctionItemManager( { activeSpreadSheet: ss, config: {} } );
    itemsTests_assertEqual_( mgr.getValidSortedItems(), [], 'missing Auction-Items sheet should yield an empty list' );
}

function itemsTests_headerOnlySheetReturnsNoItems_ () {
    const ss = itemsTests_fakeSpreadsheet_();
    ss.addSheet( 'Auction-Items', [ ITEMS_TESTS_HEADER ] );
    const mgr = new AuctionItemManager( { activeSpreadSheet: ss, config: {} } );
    itemsTests_assertEqual_( mgr.getValidSortedItems(), [], 'header-only sheet should yield an empty list' );
}

// ── AuctionItem display-fallback helpers ─────────────────────────────────

function itemsTests_isLive_ () {
    itemsTests_assertEqual_( new AuctionItem( itemsTests_itemRow_( '1301', { 1: 'Live' } ) ).isLive(), true, 'Live category should be live' );
    itemsTests_assertEqual_( new AuctionItem( itemsTests_itemRow_( '101', { 1: 'Food' } ) ).isLive(), false, 'Food category should not be live' );
}

function itemsTests_hasOpeningBid_ () {
    itemsTests_assertEqual_( new AuctionItem( itemsTests_itemRow_( '101', { 5: '' } ) ).hasOpeningBid(), false, 'blank opening bid' );
    itemsTests_assertEqual_( new AuctionItem( itemsTests_itemRow_( '101', { 5: '0' } ) ).hasOpeningBid(), true, "'0' is still a set opening bid" );
}

function itemsTests_displayFallbacks_ () {
    const blankValue = new AuctionItem( itemsTests_itemRow_( '101', { 4: '' } ) );
    itemsTests_assertEqual_( blankValue.getDisplayValue(), '500', 'blank value should fall back to 500' );
    const realValue = new AuctionItem( itemsTests_itemRow_( '101', { 4: '75' } ) );
    itemsTests_assertEqual_( realValue.getDisplayValue(), '75', 'real value should be returned as-is' );

    const blankBid = new AuctionItem( itemsTests_itemRow_( '101', { 5: '' } ) );
    itemsTests_assertEqual_( blankBid.getDisplayOpeningBid(), '5', 'blank opening bid should fall back to 5' );

    const blankRaise = new AuctionItem( itemsTests_itemRow_( '101', { 6: '' } ) );
    itemsTests_assertEqual_( blankRaise.getDisplayMinRaise(), '5', 'blank min raise should fall back to 5' );
}

function itemsTests_shortRowDefaultsMissingTrailingCellsToEmptyString_ () {
    // The Sheets API omits trailing empty cells from a row, so a row with
    // no bundle/timestamp data (or any other blank trailing columns) can
    // arrive genuinely shorter than 12 elements - not itemsTests_itemRow_'s
    // always-12-element fixture, which never exercised this path. Missing
    // cells must default to '', not undefined, or the `=== ''` fallback
    // checks silently break.
    const idOnly = new AuctionItem( [ '101' ] );
    itemsTests_assertEqual_( idOnly.id, '101', 'id from the one present cell' );
    itemsTests_assertEqual_( idOnly.category, '', 'missing category defaults to empty string, not undefined' );
    itemsTests_assertEqual_( idOnly.bundleID, '', 'missing bundleID defaults to empty string, not undefined' );
    itemsTests_assertEqual_( idOnly.bundleTimeStamp, '', 'missing bundleTimeStamp defaults to empty string, not undefined' );

    itemsTests_assertEqual_( idOnly.getDisplayValue(), '500', 'missing value should still fall back to 500, not "undefined"' );
    itemsTests_assertEqual_( idOnly.getDisplayOpeningBid(), '5', 'missing opening bid should still fall back to 5, not "undefined"' );
    itemsTests_assertEqual_( idOnly.getDisplayMinRaise(), '5', 'missing min raise should still fall back to 5, not "undefined"' );
    itemsTests_assertEqual_( idOnly.hasOpeningBid(), false, 'missing opening bid should read as not-set' );
}

// ── GoogleAIStudio._executeGeneration / itemManager override ────────────

function itemsTests_executeGeneration_success_ () {
    const studio = new GoogleAIStudio();
    const result = studio._executeGeneration( function () {}, 'Done!', 'testLabel' );
    itemsTests_assertEqual_( result, { success: true, message: 'Done!' }, 'successful action should report success' );
}

function itemsTests_executeGeneration_catchesErrors_ () {
    const studio = new GoogleAIStudio();
    const result = studio._executeGeneration( function () { throw new Error( 'Drive quota exceeded' ); }, 'Done!', 'testLabel' );
    itemsTests_assertEqual_( result, { success: false, error: 'Error: Drive quota exceeded' }, 'thrown error should be caught and reported, not thrown to the caller' );
}

function itemsTests_itemManagerOverride_ () {
    const fakeItemManager = { marker: 'this is the fake' };
    const studio = new GoogleAIStudio( { itemManager: fakeItemManager } );
    if ( studio.itemManager !== fakeItemManager ) {
        throw new Error( 'itemManager getter should return the injected override by reference' );
    }
}

// ── Runner ────────────────────────────────────────────────────────────────

function runItemsSpreadsheetUnitTests () {
    const cases = [
        [ 'getValidSortedItems: excludes inactive/deleted', itemsTests_excludesInactiveAndDeleted_ ],
        [ 'getValidSortedItems: sorts numerically by ID', itemsTests_sortsNumericallyById_ ],
        [ 'getValidSortedItems: missing sheet -> empty list', itemsTests_emptySheetReturnsNoItems_ ],
        [ 'getValidSortedItems: header-only sheet -> empty list', itemsTests_headerOnlySheetReturnsNoItems_ ],
        [ 'AuctionItem: isLive()', itemsTests_isLive_ ],
        [ 'AuctionItem: hasOpeningBid()', itemsTests_hasOpeningBid_ ],
        [ 'AuctionItem: display fallbacks', itemsTests_displayFallbacks_ ],
        [ 'AuctionItem: short row defaults missing trailing cells to \'\'', itemsTests_shortRowDefaultsMissingTrailingCellsToEmptyString_ ],
        [ '_executeGeneration: success', itemsTests_executeGeneration_success_ ],
        [ '_executeGeneration: catches errors', itemsTests_executeGeneration_catchesErrors_ ],
        [ 'itemManager override', itemsTests_itemManagerOverride_ ]
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
