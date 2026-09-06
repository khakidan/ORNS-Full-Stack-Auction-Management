/**
 * REAL unit tests for PayPalSweeper.gs's checkPendingPayPalInvoices (the
 * live time-driven trigger). Run `runGoogleAIStudioAndSweeperUnitTests`
 * from the Apps Script editor's function dropdown.
 *
 * (This file used to also cover GoogleAIStudio.recordPayment, before that
 * function was ported to Node and removed from Class_GoogleAIStudio.gs -
 * see docs/agents/refactor-opportunities.md's Code Hardening item #2, Step
 * 3 / CHANGELOG.md. Its dead tests were removed here rather than left
 * permanently failing.)
 *
 * Reuses the assert helpers (paypalTests_assertEqual_/assertThrows_) from
 * PayPalService_UnitTests.gs - both files must exist in the project.
 *
 * Like that file, everything here is faked (a fake spreadsheet/sheet and a
 * fake PayPalService), so this never touches a real sheet, the real PayPal
 * API, or real credentials, and is safe to run at any time.
 */

// ── Fake Spreadsheet/Sheet ───────────────────────────────────────────────

function gasTests_fakeSheet_ ( initialRows ) {
    const data = initialRows.map( function ( row ) { return row.slice(); } );
    return {
        data: data,
        getDataRange: function () {
            const snapshot = data.map( function ( row ) { return row.slice(); } );
            return { getValues: function () { return snapshot; } };
        },
        getRange: function ( a, b ) {
            if ( typeof a === 'string' ) {
                const stub = {};
                stub.setFontWeight = function () { return stub; };
                stub.setBackground = function () { return stub; };
                return stub;
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

function gasTests_fakeSpreadsheet_ () {
    const sheets = {};
    return {
        addSheet: function ( name, rows ) {
            sheets[ name ] = gasTests_fakeSheet_( rows || [] );
            return sheets[ name ];
        },
        getSheetByName: function ( name ) { return sheets[ name ] || null; },
        insertSheet: function ( name ) { return this.addSheet( name, [] ); }
    };
}

// Column layout of a Bidder-Numbers row (0-indexed), matching
// Class_BidderManager.gs's real header write (copyBiddersToBidderSheet):
// A id, B firstName, C lastName, D email, E checkedIn, F proxy,
// G checkedOut, H paid, I methodLabel, J invoiceUrl, K invoicedAmount, L timestamp
const GAS_TESTS_HEADER = [ 'ID', 'First', 'Last', 'Email', 'CheckedIn', 'Proxy', 'CheckedOut', 'Paid', 'Method', 'InvoiceURL', 'Amount', 'Timestamp' ];

function gasTests_pendingRow_ ( overrides ) {
    const row = [ '101', 'Jane', 'Doe', 'jane@example.com', true, false, false, false, 'PayPal Verification Pending', 'https://www.paypal.com/invoice/p/#INV2-X', 104.12, '' ];
    Object.keys( overrides || {} ).forEach( function ( k ) { row[ k ] = overrides[ k ]; } );
    return row;
}

// ── PayPalSweeper.checkPendingPayPalInvoices ─────────────────────────────

const GAS_TESTS_NOW = new Date( '2026-01-01T12:00:00.000Z' ).getTime();

function gasTests_sweeper_marksPaid_ () {
    const ss = gasTests_fakeSpreadsheet_();
    const sheet = ss.addSheet( 'Bidder-Numbers', [ GAS_TESTS_HEADER, gasTests_pendingRow_( {} ) ] );

    checkPendingPayPalInvoices( {
        activeSpreadSheet: ss,
        now: GAS_TESTS_NOW,
        paypalService: { extractInvoiceIdFromUrl: function () { return 'INV2-X'; }, getInvoiceStatus: function () { return 'PAID'; } }
    } );

    paypalTests_assertEqual_( sheet.data[ 1 ][ 6 ], true, 'sweeper should mark a PAID invoice as paid' );
    paypalTests_assertEqual_( sheet.data[ 1 ][ 8 ], 'Credit Card / PayPal', 'sweeper should update the method label on success' );
}

function gasTests_sweeper_seedsTimestampWithoutEscalating_ () {
    const ss = gasTests_fakeSpreadsheet_();
    const sheet = ss.addSheet( 'Bidder-Numbers', [ GAS_TESTS_HEADER, gasTests_pendingRow_( { 11: '' } ) ] );

    checkPendingPayPalInvoices( {
        activeSpreadSheet: ss,
        now: GAS_TESTS_NOW,
        paypalService: { extractInvoiceIdFromUrl: function () { return 'INV2-X'; }, getInvoiceStatus: function () { return 'SENT'; } }
    } );

    paypalTests_assertEqual_( sheet.data[ 1 ][ 8 ], 'PayPal Verification Pending', 'should not escalate on the first sweep with no timestamp yet' );
    if ( !sheet.data[ 1 ][ 11 ] ) throw new Error( 'Expected the sweeper to seed a timestamp' );
}

function gasTests_sweeper_escalatesAfterTimeout_ () {
    const ss = gasTests_fakeSpreadsheet_();
    const oldTimestamp = new Date( GAS_TESTS_NOW - 11 * 60 * 1000 ).toISOString();
    const sheet = ss.addSheet( 'Bidder-Numbers', [ GAS_TESTS_HEADER, gasTests_pendingRow_( { 11: oldTimestamp } ) ] );

    checkPendingPayPalInvoices( {
        activeSpreadSheet: ss,
        now: GAS_TESTS_NOW,
        paypalService: { extractInvoiceIdFromUrl: function () { return 'INV2-X'; }, getInvoiceStatus: function () { return 'SENT'; } }
    } );

    paypalTests_assertEqual_( sheet.data[ 1 ][ 8 ], 'Failed Verification - Follow Up Required', 'row pending past 10 minutes should escalate' );
    const followUp = ss.getSheetByName( 'PayPal-Follow-Up' );
    if ( !followUp ) throw new Error( 'Expected a PayPal-Follow-Up sheet to be created' );
    paypalTests_assertEqual_( followUp.data[ 0 ], [ 'Timestamp', 'Bidder Number', 'Name', 'Amount Flagged', 'Invoice URL', 'System Notes' ], 'PayPal-Follow-Up sheet should get the standard header' );
    paypalTests_assertEqual_( followUp.data[ 1 ][ 1 ], '101', 'escalation row should log the bidder number' );
}

function gasTests_sweeper_leavesRecentRowAlone_ () {
    const ss = gasTests_fakeSpreadsheet_();
    const recentTimestamp = new Date( GAS_TESTS_NOW - 2 * 60 * 1000 ).toISOString();
    const sheet = ss.addSheet( 'Bidder-Numbers', [ GAS_TESTS_HEADER, gasTests_pendingRow_( { 11: recentTimestamp } ) ] );

    checkPendingPayPalInvoices( {
        activeSpreadSheet: ss,
        now: GAS_TESTS_NOW,
        paypalService: { extractInvoiceIdFromUrl: function () { return 'INV2-X'; }, getInvoiceStatus: function () { return 'SENT'; } }
    } );

    paypalTests_assertEqual_( sheet.data[ 1 ][ 8 ], 'PayPal Verification Pending', 'a recently-pending row should not be touched yet' );
    paypalTests_assertEqual_( sheet.data[ 1 ][ 11 ], recentTimestamp, 'timestamp should be untouched' );
}

function gasTests_sweeper_ignoresNonPendingRows_ () {
    const ss = gasTests_fakeSpreadsheet_();
    const sheet = ss.addSheet( 'Bidder-Numbers', [ GAS_TESTS_HEADER, gasTests_pendingRow_( { 8: 'Cash' } ) ] );

    checkPendingPayPalInvoices( { activeSpreadSheet: ss, now: GAS_TESTS_NOW, paypalService: {} } );

    paypalTests_assertEqual_( sheet.data[ 1 ][ 8 ], 'Cash', 'a row not flagged pending should never be evaluated' );
}

// ── Runner ────────────────────────────────────────────────────────────────

function runGoogleAIStudioAndSweeperUnitTests () {
    const cases = [
        [ 'sweeper: marks paid', gasTests_sweeper_marksPaid_ ],
        [ 'sweeper: seeds timestamp without escalating', gasTests_sweeper_seedsTimestampWithoutEscalating_ ],
        [ 'sweeper: escalates after timeout', gasTests_sweeper_escalatesAfterTimeout_ ],
        [ 'sweeper: leaves recent row alone', gasTests_sweeper_leavesRecentRowAlone_ ],
        [ 'sweeper: ignores non-pending rows', gasTests_sweeper_ignoresNonPendingRows_ ]
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
