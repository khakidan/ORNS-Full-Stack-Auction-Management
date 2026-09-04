/**
 * REAL unit tests for Class_BidderManager.gs's `_collectGuestInfo_` /
 * `_collectGuestTickets_` - the logic `copyBiddersToBidderSheet()` (the
 * "Set Up Bid Management App" sync) uses to decide which ticket-purchase
 * guests get their own row in Bidder-Numbers, and therefore their own
 * printed bidder-number label. Run `runBidderManagerUnitTests` from the
 * Apps Script editor's function dropdown.
 *
 * Regression guard for a real, user-reported bug: a guest with a real
 * name/email who explicitly opted in for their own bidder number ("yes"
 * in their own-bidder-number column) still never got a label.
 * `_collectGuestInfo_` used to also require a SEPARATE "guest marker"
 * checkbox (column index 6) to be non-blank before even looking at the
 * guest's own name or opt-in answer - a column the Node-side equivalent
 * (server/services/syncService.ts's collectGuestInfo, and further
 * upstream, src/lib/attendeeParsing.ts's own guest-inclusion check) never
 * required. A guest whose row simply never had that separate checkbox
 * ticked was silently dropped, even though they were visibly listed with
 * an "Own #" badge in the live app. See server/test/tickets.test.ts and
 * server/test/gs-bidmanagement-bidder-manager.test.ts for the equivalent
 * Node-side regression guards (the latter loads this exact .gs source via
 * a Node vm sandbox, not a reimplementation).
 *
 * Reuses the assert helper (paypalTests_assertEqual_) from
 * PayPalService_UnitTests.gs - that file must exist in the project.
 *
 * Everything here is faked (a fake spreadsheet/sheet), so this never
 * touches a real sheet and is safe to run at any time.
 */

// ── Fake Spreadsheet/Sheet (supports getLastRow/getLastColumn and the
//    4-arg getRange(row, col, numRows, numCols) form BidderManager's
//    _getTicketPackage/`bidders` getter use, unlike the simpler 2-arg-only
//    fake in GoogleAIStudioAndSweeper_UnitTests.gs) ────────────────────────

function bidderManagerTests_fakeSheet_ ( initialRows ) {
    const data = initialRows.map( function ( row ) { return row.slice(); } );
    return {
        data: data,
        getDataRange: function () {
            const snapshot = data.map( function ( row ) { return row.slice(); } );
            return { getValues: function () { return snapshot; } };
        },
        getRange: function ( a, b, numRows, numCols ) {
            if ( typeof a === 'string' ) {
                const stub = {};
                stub.setFontWeight = function () { return stub; };
                stub.setBackground = function () { return stub; };
                return stub;
            }
            const row = a;
            const col = b;
            if ( numRows !== undefined && numCols !== undefined ) {
                const rows = data.slice( row - 1, row - 1 + numRows ).map( function ( r ) {
                    const padded = r.slice();
                    while ( padded.length < numCols ) padded.push( '' );
                    return padded.slice( 0, numCols );
                } );
                return {
                    getValues: function () { return rows; },
                    setValues: function ( values ) {
                        values.forEach( function ( v, i ) { data[ row - 1 + i ] = v.slice(); } );
                    }
                };
            }
            return {
                setValue: function ( v ) { data[ row - 1 ][ col - 1 ] = v; },
                getValue: function () { return data[ row - 1 ] ? data[ row - 1 ][ col - 1 ] : undefined; },
                clearContent: function () { data[ row - 1 ][ col - 1 ] = ''; }
            };
        },
        getLastRow: function () { return data.length; },
        getLastColumn: function () {
            return data.reduce( function ( max, row ) { return Math.max( max, row.length ); }, 0 );
        },
        appendRow: function ( row ) { data.push( row ); }
    };
}

function bidderManagerTests_fakeSpreadsheet_ () {
    const sheets = {};
    return {
        addSheet: function ( name, rows ) {
            sheets[ name ] = bidderManagerTests_fakeSheet_( rows || [] );
            return sheets[ name ];
        },
        getSheetByName: function ( name ) { return sheets[ name ] || null; },
        insertSheet: function ( name ) { return this.addSheet( name, [] ); }
    };
}

// Column layout matches attendeeParsing.ts/syncService.ts's own: 0 first,
// 1 last, 2 email, 3-5 unused here, 6 "guest marker" checkbox, 7/8/9 guest
// 1 first/last/email, 10 guest 1 own-number flag, 11-14 guest 2 (shifted),
// 15-18 guest 3 (shifted).
function bidderManagerTests_ticketRow_ ( overrides ) {
    const row = [];
    for ( let i = 0; i < 19; i++ ) row.push( '' );
    Object.keys( overrides || {} ).forEach( function ( k ) { row[ k ] = overrides[ k ]; } );
    return row;
}

function bidderManagerTests_makeManager_ ( rows ) {
    const activeSpreadSheet = bidderManagerTests_fakeSpreadsheet_();
    const ticketsSpreadsheet = bidderManagerTests_fakeSpreadsheet_();
    ticketsSpreadsheet.addSheet( 'tickets', [ [ 'Header' ] ].concat( rows ) );

    const manager = new BidderManager( {
        activeSpreadSheet: activeSpreadSheet,
        config: {},
        ticketsSpreadsheet: ticketsSpreadsheet
    } );
    manager.collectedBidders = [];
    return manager;
}

// ── Tests ─────────────────────────────────────────────────────────────────

function bidderManagerTests_guestMarkerBlank_stillCollected_ () {
    const row = bidderManagerTests_ticketRow_( { 0: 'Dan', 1: 'Sage', 2: 'dan@example.com', 6: '', 7: 'Jimmy', 8: 'Smith', 9: 'smith@smith.com', 10: 'yes' } );
    const manager = bidderManagerTests_makeManager_( [ row ] );

    manager._collectGuestTickets_();

    paypalTests_assertEqual_( manager.collectedBidders, [ [ 'Jimmy', 'Smith', 'smith@smith.com' ] ], 'a guest with a real name/opt-in must be collected even when the guest-marker column is blank' );
}

function bidderManagerTests_guestMarkerSet_stillCollected_ () {
    const row = bidderManagerTests_ticketRow_( { 0: 'Dan', 1: 'Sage', 2: 'dan@example.com', 6: 'Has Guest', 7: 'Jimmy', 8: 'Smith', 9: 'smith@smith.com', 10: 'yes' } );
    const manager = bidderManagerTests_makeManager_( [ row ] );

    manager._collectGuestTickets_();

    paypalTests_assertEqual_( manager.collectedBidders, [ [ 'Jimmy', 'Smith', 'smith@smith.com' ] ], 'the previously-passing case (guest marker set) must be unaffected by the fix' );
}

function bidderManagerTests_notOptedIn_excluded_ () {
    const row = bidderManagerTests_ticketRow_( { 0: 'Dan', 1: 'Sage', 7: 'Jimmy', 8: 'Smith', 9: 'smith@smith.com', 10: 'no' } );
    const manager = bidderManagerTests_makeManager_( [ row ] );

    manager._collectGuestTickets_();

    paypalTests_assertEqual_( manager.collectedBidders, [], 'a guest who did not opt in must not be collected' );
}

function bidderManagerTests_emptyGuestSlot_excluded_ () {
    const row = bidderManagerTests_ticketRow_( { 0: 'Dan', 1: 'Sage', 10: 'yes' } );
    const manager = bidderManagerTests_makeManager_( [ row ] );

    manager._collectGuestTickets_();

    paypalTests_assertEqual_( manager.collectedBidders, [], 'an empty guest slot must not be collected even with a stray "yes" in the opt-in column' );
}

function bidderManagerTests_allThreeGuests_matchesReportedRow_ () {
    // Matches the user's exact reported row: Jimmy Smith and Amy Sedaris
    // both opted in for their own number, Hue Tint did not.
    const row = bidderManagerTests_ticketRow_( {
        0: 'Dan', 1: 'Sage', 2: 'dan@example.com',
        7: 'Jimmy', 8: 'Smith', 9: 'smith@smith.com', 10: 'yes',
        11: 'Amy', 12: 'Sedaris', 13: 'sedaris@gmail.com', 14: 'yes',
        15: 'Hue', 16: 'Tint', 17: 'afdhkj@gjlkadfs.com', 18: 'no'
    } );
    const manager = bidderManagerTests_makeManager_( [ row ] );

    manager._collectGuestTickets_();

    paypalTests_assertEqual_(
        manager.collectedBidders,
        [ [ 'Jimmy', 'Smith', 'smith@smith.com' ], [ 'Amy', 'Sedaris', 'sedaris@gmail.com' ] ],
        'both opted-in guests must be collected together, the non-opted-in one skipped'
    );
}

// ── Runner ────────────────────────────────────────────────────────────────

function runBidderManagerUnitTests () {
    const cases = [
        [ 'guest marker blank, real name + opt-in: still collected (the reported bug)', bidderManagerTests_guestMarkerBlank_stillCollected_ ],
        [ 'guest marker set: still collected (unaffected by the fix)', bidderManagerTests_guestMarkerSet_stillCollected_ ],
        [ 'not opted in: excluded', bidderManagerTests_notOptedIn_excluded_ ],
        [ 'empty guest slot: excluded', bidderManagerTests_emptyGuestSlot_excluded_ ],
        [ 'all three guests: matches reported row', bidderManagerTests_allThreeGuests_matchesReportedRow_ ]
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
