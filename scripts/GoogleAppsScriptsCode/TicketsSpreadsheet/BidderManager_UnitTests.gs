/**
 * REAL unit tests for BidderManager.getAllBidders and GoogleAIStudio's
 * bidderManager override / fetch-before-construct ordering - runnable from
 * the Apps Script editor (select `runTicketsSpreadsheetUnitTests` in the
 * function dropdown and run).
 *
 * Everything here is faked (fake spreadsheets, fake bidder manager), so this
 * never touches a real sheet and is safe to run at any time, including
 * against production data.
 *
 * getAllBidders is correctness-critical: printed bidder labels are affixed
 * to bidding guides before the auction starts, and the number on each label
 * must match the number the app actually uses to record that person's bids
 * - see Class_BidderManager.gs's header comment for the full rationale.
 *
 * Deliberately NOT covered here: the full label-document generation itself
 * (BidderLabelsDoc/DocumentApp/DriveApp output) - same scoping call made for
 * the Items-spreadsheet's 8 document generators. See refactor-opportunities.md.
 *
 * The equivalent Node/Vitest suites (server/test/gs-tickets-bidder-manager.test.ts,
 * server/test/gs-tickets-google-ai-studio.test.ts) run this exact same source
 * file's logic inside this app's own test run - use these editor-run tests
 * when you want to sanity-check the live Apps Script project directly,
 * without a local checkout.
 */

// ── Tiny assertion helpers ───────────────────────────────────────────────

function ticketsTests_assertEqual_ ( actual, expected, message ) {
    const a = JSON.stringify( actual );
    const e = JSON.stringify( expected );
    if ( a !== e ) {
        throw new Error( `${ message }\n  Expected: ${ e }\n  Actual:   ${ a }` );
    }
}

function ticketsTests_assertThrows_ ( fn, messageMatch, message ) {
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

function ticketsTests_fakeSheet_ ( initialRows ) {
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

function ticketsTests_fakeSpreadsheet_ () {
    const sheets = {};
    return {
        addSheet: function ( name, rows ) {
            sheets[ name ] = ticketsTests_fakeSheet_( rows || [] );
            return sheets[ name ];
        },
        getSheetByName: function ( name ) { return sheets[ name ] || null; },
        insertSheet: function ( name ) { return this.addSheet( name, [] ); }
    };
}

const TICKETS_TESTS_BIDDER_NUMBERS_HEADER = [ 'ID', 'First Name', 'Last Name', 'Email', 'Checked In', 'Proxy Bidder', 'Checked Out', 'Paid', 'Payment Method', 'Invoice URL', 'Invoiced Amount' ];

function ticketsTests_fakeBidManagementSpreadsheet_ ( rows ) {
    const ss = ticketsTests_fakeSpreadsheet_();
    ss.addSheet( 'Bidder-Numbers', [ TICKETS_TESTS_BIDDER_NUMBERS_HEADER ].concat( rows || [] ) );
    return ss;
}

function ticketsTests_makeManager_ ( ticketsRows, bidderNumberRows ) {
    const spreadsheet = ticketsTests_fakeSpreadsheet_();
    Object.keys( ticketsRows || {} ).forEach( function ( sheetName ) {
        spreadsheet.addSheet( sheetName, [ [ 'Header' ] ].concat( ticketsRows[ sheetName ] ) );
    } );
    return new BidderManager( {
        activeSpreadSheet: spreadsheet,
        config: {},
        bidManagementSpreadsheet: ticketsTests_fakeBidManagementSpreadsheet_( bidderNumberRows )
    } );
}

// ── BidderManager.getAllBidders ──────────────────────────────────────────

function ticketsTests_noSpreadsheetIdThrows_ () {
    const mgr = ticketsTests_makeManager_( {}, [] );
    ticketsTests_assertThrows_( function () { mgr.getAllBidders(); }, 'requires a Bid-Management spreadsheet ID', 'missing ID should throw' );
}

function ticketsTests_emptyBidderNumbersThrows_ () {
    const mgr = ticketsTests_makeManager_( { tickets: [ [ 'Alice', 'One', 'alice@example.com' ] ] }, [] );
    ticketsTests_assertThrows_( function () { mgr.getAllBidders( 'bm-id' ); }, 'Set Up Bid Management App', 'unsynced Bidder-Numbers should throw' );
}

function ticketsTests_looksUpRealNumber_ () {
    const mgr = ticketsTests_makeManager_(
        { tickets: [ [ 'Alice', 'One', 'alice@example.com' ] ] },
        [ [ '205', 'Alice', 'One', 'alice@example.com' ] ]
    );
    const bidders = mgr.getAllBidders( 'bm-id' );
    ticketsTests_assertEqual_( bidders.length, 1, 'should return one bidder' );
    ticketsTests_assertEqual_( bidders[ 0 ].getNumber(), '205', 'should use the real Bidder-Numbers ID, not an invented one' );
    ticketsTests_assertEqual_( bidders[ 0 ].getDisplayName(), 'Alice One', 'display name should be first + last' );
}

function ticketsTests_matchesCaseInsensitively_ () {
    const mgr = ticketsTests_makeManager_(
        { tickets: [ [ '  ALICE  ', 'one', '  ALICE@Example.com  ' ] ] },
        [ [ '205', 'Alice', 'One', 'alice@example.com' ] ]
    );
    const bidders = mgr.getAllBidders( 'bm-id' );
    ticketsTests_assertEqual_( bidders.length, 1, 'should match despite case/whitespace differences' );
    ticketsTests_assertEqual_( bidders[ 0 ].getNumber(), '205', 'should resolve to the real ID' );
}

function ticketsTests_unmatchedPrimaryThrows_ () {
    const mgr = ticketsTests_makeManager_(
        { tickets: [ [ 'Alice', 'One', 'alice@example.com' ], [ 'Ghost', 'Person', 'ghost@example.com' ] ] },
        [ [ '205', 'Alice', 'One', 'alice@example.com' ] ]
    );
    ticketsTests_assertThrows_( function () { mgr.getAllBidders( 'bm-id' ); }, 'Ghost Person', 'unmatched primary bidder should be named in a hard error' );
}

function ticketsTests_unmatchedGuestSkipped_ () {
    const row = new Array( 18 ).fill( '' );
    row[ 0 ] = 'Alice'; row[ 1 ] = 'One'; row[ 2 ] = 'alice@example.com';
    row[ 7 ] = 'Bob'; row[ 8 ] = 'Guest'; row[ 9 ] = 'bob@example.com'; // not in Bidder-Numbers
    const mgr = ticketsTests_makeManager_(
        { tickets: [ row ] },
        [ [ '205', 'Alice', 'One', 'alice@example.com' ] ]
    );
    const bidders = mgr.getAllBidders( 'bm-id' );
    ticketsTests_assertEqual_( bidders.length, 1, 'unmatched guest should be silently skipped, not thrown' );
    ticketsTests_assertEqual_( bidders[ 0 ].getDisplayName(), 'Alice One', 'only the matched primary should remain' );
}

function ticketsTests_correctedGuestColumns_ () {
    const row = new Array( 18 ).fill( '' );
    row[ 0 ] = 'Alice'; row[ 1 ] = 'One'; row[ 2 ] = 'alice@example.com';
    row[ 11 ] = 'Carol'; row[ 12 ] = 'Guest2'; row[ 13 ] = 'carol@example.com'; // guest 2
    row[ 15 ] = 'Dave'; row[ 16 ] = 'Guest3'; row[ 17 ] = 'dave@example.com'; // guest 3
    const mgr = ticketsTests_makeManager_(
        { tickets: [ row ] },
        [
            [ '205', 'Alice', 'One', 'alice@example.com' ],
            [ '206', 'Carol', 'Guest2', 'carol@example.com' ],
            [ '207', 'Dave', 'Guest3', 'dave@example.com' ]
        ]
    );
    const names = mgr.getAllBidders( 'bm-id' ).map( function ( b ) { return b.getDisplayName(); } );
    ticketsTests_assertEqual_( names, [ 'Alice One', 'Carol Guest2', 'Dave Guest3' ], 'guest 2/3 must use the corrected (shifted) column offsets - this was the original bug' );
}

function ticketsTests_staffAndSponsorHaveNoGuests_ () {
    const mgr = ticketsTests_makeManager_(
        {
            'staff tickets': [ [ 'Staff', 'Member', 'staff@example.com' ] ],
            'sponsor tickets': [ [ 'Sponsor', 'Person', 'sponsor@example.com' ] ]
        },
        [
            [ '101', 'Staff', 'Member', 'staff@example.com' ],
            [ '102', 'Sponsor', 'Person', 'sponsor@example.com' ]
        ]
    );
    const names = mgr.getAllBidders( 'bm-id' ).map( function ( b ) { return b.getDisplayName(); } );
    ticketsTests_assertEqual_( names, [ 'Staff Member', 'Sponsor Person' ], 'staff/sponsor should never gain guests - intentional, per product decision' );
}

function ticketsTests_sortedByNumber_ () {
    const mgr = ticketsTests_makeManager_(
        { tickets: [ [ 'Zed', 'Last', 'zed@example.com' ], [ 'Amy', 'First', 'amy@example.com' ] ] },
        [
            [ '310', 'Zed', 'Last', 'zed@example.com' ],
            [ '105', 'Amy', 'First', 'amy@example.com' ]
        ]
    );
    const numbers = mgr.getAllBidders( 'bm-id' ).map( function ( b ) { return b.getNumber(); } );
    ticketsTests_assertEqual_( numbers, [ '105', '310' ], 'result should be sorted ascending by bidder number, not sheet-read order' );
}

// ── GoogleAIStudio bidderManager override / ordering ─────────────────────

function ticketsTests_bidderManagerOverride_ () {
    const fakeBidderManager = { marker: 'this is the fake' };
    const studio = new GoogleAIStudio( { bidderManager: fakeBidderManager } );
    if ( studio.bidderManager !== fakeBidderManager ) {
        throw new Error( 'bidderManager should return the injected override by reference' );
    }
}

function ticketsTests_hardErrorStopsBeforeDocConstruction_ () {
    const fakeBidderManager = {
        getAllBidders: function () { throw new Error( 'unmatched bidders: Ghost Person' ); }
    };
    const studio = new GoogleAIStudio( { bidderManager: fakeBidderManager } );
    ticketsTests_assertThrows_(
        function () { studio.createBidderLabels( null, 'bm-id' ); },
        'unmatched bidders: Ghost Person',
        'createBidderLabels should propagate getAllBidders errors, not a "BidderLabelsDoc is not defined" error (which would prove it constructed the doc first)'
    );
}

// ── Runner ────────────────────────────────────────────────────────────────

function runTicketsSpreadsheetUnitTests () {
    const cases = [
        [ 'getAllBidders: missing spreadsheet ID throws', ticketsTests_noSpreadsheetIdThrows_ ],
        [ 'getAllBidders: empty Bidder-Numbers throws', ticketsTests_emptyBidderNumbersThrows_ ],
        [ 'getAllBidders: looks up real number', ticketsTests_looksUpRealNumber_ ],
        [ 'getAllBidders: matches case-insensitively', ticketsTests_matchesCaseInsensitively_ ],
        [ 'getAllBidders: unmatched primary throws', ticketsTests_unmatchedPrimaryThrows_ ],
        [ 'getAllBidders: unmatched guest skipped', ticketsTests_unmatchedGuestSkipped_ ],
        [ 'getAllBidders: corrected guest 2/3 columns', ticketsTests_correctedGuestColumns_ ],
        [ 'getAllBidders: staff/sponsor have no guests', ticketsTests_staffAndSponsorHaveNoGuests_ ],
        [ 'getAllBidders: sorted by bidder number', ticketsTests_sortedByNumber_ ],
        [ 'GoogleAIStudio: bidderManager override', ticketsTests_bidderManagerOverride_ ],
        [ 'GoogleAIStudio: hard error stops before doc construction', ticketsTests_hardErrorStopsBeforeDocConstruction_ ]
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
