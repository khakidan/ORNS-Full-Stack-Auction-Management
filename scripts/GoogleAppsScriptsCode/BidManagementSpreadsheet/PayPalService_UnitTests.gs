/**
 * REAL unit tests for PayPalService, runnable from the Apps Script editor
 * (select `runPayPalServiceUnitTests` in the function dropdown and run).
 *
 * Unlike API_PAYPAL_TESTS.gs (which hits the live PayPal sandbox API and
 * a real bidder row, and needs the log read by eye), these tests use
 * PayPalService's injectable `fetcher`/`clientId`/`clientSecret`/`isSandbox`
 * overrides to fake every network call, so they:
 *   - run in milliseconds, with no PayPal credentials or network access
 *   - make real assertions (a failure throws and is caught, logged, and
 *     counted - it does not require a human to read Logger output and judge)
 *   - are safe to run at any time, including against production data,
 *     since nothing here ever calls the real PayPal API
 *
 * The equivalent Node/Vitest suite (server/test/gs-paypal-service.test.ts)
 * runs this exact same source file's logic inside this app's own test
 * run - use these editor-run tests when you want to sanity-check the
 * live Apps Script project directly, without a local checkout.
 */

// ── Tiny assertion helpers ───────────────────────────────────────────────

function paypalTests_assertEqual_ ( actual, expected, message ) {
    const a = JSON.stringify( actual );
    const e = JSON.stringify( expected );
    if ( a !== e ) {
        throw new Error( `${ message }\n  Expected: ${ e }\n  Actual:   ${ a }` );
    }
}

function paypalTests_assertThrows_ ( fn, messageMatch, message ) {
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

/**
 * Fakes UrlFetchApp.fetch. `responsesByCallIndex` is an array; call N of
 * the returned fetcher returns responsesByCallIndex[N] (or the last entry,
 * if the array is shorter than the number of calls made).
 *
 * Captures `options.payload` into the log entry BY VALUE at call-time
 * (not the `options` object reference) - some PayPalService methods
 * build one `options` object and mutate/reuse it across multiple fetch
 * calls (e.g. createAndSendInvoice's draft-then-send steps), so logging
 * the object reference itself would make every log entry reflect only
 * the LAST mutation once the method finishes, not the value at the time
 * each individual call actually happened.
 */
function paypalTests_fakeFetcher_ ( responsesByCallIndex, callLog ) {
    let callIndex = 0;
    return function ( url, options ) {
        if ( callLog ) callLog.push( { url: url, payload: options.payload } );
        const response = responsesByCallIndex[ Math.min( callIndex, responsesByCallIndex.length - 1 ) ];
        callIndex++;
        return response;
    };
}

function paypalTests_fakeResponse_ ( responseCode, body ) {
    const text = typeof body === 'string' ? body : JSON.stringify( body );
    return {
        getResponseCode: function () { return responseCode; },
        getContentText: function () { return text; }
    };
}

function paypalTests_newService_ ( overrides ) {
    // A no-op default fetcher, so tests that never expect a network call
    // don't fall through to the constructor's real UrlFetchApp fallback.
    const base = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        isSandbox: true,
        fetcher: function () { throw new Error( 'Unexpected fetch call - this test did not provide a fetcher override for it.' ); }
    };
    return new PayPalService( Object.assign( base, overrides || {} ) );
}

// ── Test cases ────────────────────────────────────────────────────────────

function paypalTests_extractInvoiceIdFromUrl_ () {
    const paypal = paypalTests_newService_( {} );

    paypalTests_assertEqual_(
        paypal.extractInvoiceIdFromUrl( 'https://www.paypal.com/invoice/p/#INV2-6WTA-NK56-2FAQ-PVGR' ),
        'INV2-6WTA-NK56-2FAQ-PVGR',
        'Real production URL should extract its INV2- fragment unchanged'
    );

    paypalTests_assertEqual_(
        paypal.extractInvoiceIdFromUrl( 'https://www.sandbox.paypal.com/invoice/p/#inv-H38U-JGHJ-F3UZ-HLX3' ),
        'INV2-H38U-JGHJ-F3UZ-HLX3',
        'Real sandbox URL should have its lowercase inv- prefix normalized to INV2-'
    );

    paypalTests_assertEqual_(
        paypal.extractInvoiceIdFromUrl( '' ),
        null,
        'Empty string should return null'
    );

    paypalTests_assertEqual_(
        paypal.extractInvoiceIdFromUrl( null ),
        null,
        'Null should return null'
    );
}

function paypalTests_calculatePayPalSurcharge_ () {
    const paypal = paypalTests_newService_( {} );

    paypalTests_assertEqual_(
        paypal.calculatePayPalSurcharge( 100 ),
        { total: 104.12, surcharge: 4.12 },
        '3.49% + $0.49 on a $100 bid should total $104.12'
    );

    paypalTests_assertEqual_(
        paypal.calculatePayPalSurcharge( 0 ),
        { total: 0.51, surcharge: 0.51 },
        '3.49% + $0.49 on a $0 bid should still total the flat fee, grossed up'
    );
}

function paypalTests_getAccessToken_ () {
    paypalTests_assertThrows_(
        function () { paypalTests_newService_( { clientId: '', clientSecret: '' } ).getAccessToken_(); },
        'Missing PayPal credentials',
        'getAccessToken_ should throw when credentials are missing'
    );

    const paypal = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 200, { access_token: 'fake-token' } ) ] )
    } );
    paypalTests_assertEqual_( paypal.getAccessToken_(), 'fake-token', 'getAccessToken_ should return the token on a 200 response' );

    const failing = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 401, 'invalid_client' ) ] )
    } );
    paypalTests_assertThrows_(
        function () { failing.getAccessToken_(); },
        'PayPal API Authentication Failed',
        'getAccessToken_ should throw with the response body on a non-200'
    );
}

function paypalTests_createAndSendInvoice_ () {
    const callLog = [];
    const paypal = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [
            paypalTests_fakeResponse_( 200, { access_token: 'tok' } ),
            paypalTests_fakeResponse_( 201, { id: 'INV2-TEST-0000-0000-0001' } ),
            paypalTests_fakeResponse_( 200, { links: [ { rel: 'payer-action', href: 'https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001' } ] } )
        ], callLog )
    } );

    const result = paypal.createAndSendInvoice(
        { email: 'bidder@example.com', firstName: 'Jane', lastName: 'Doe', id: '101' },
        [
            { name: 'Gift Card', amount: 100 },
            { name: 'Ten Raffle Tickets', amount: 30 }
        ]
    );

    const expectedFee = paypal.calculatePayPalSurcharge( 130 );
    paypalTests_assertEqual_(
        result,
        { invoiceId: 'INV2-TEST-0000-0000-0001', totalAmount: expectedFee.total, checkoutUrl: 'https://www.sandbox.paypal.com/invoice/p/#inv-TEST0000000001' },
        'createAndSendInvoice should return the invoice ID, fee-inclusive total, and payer-action checkout URL'
    );

    // callLog[1] is the draft-invoice request - capture its payload before
    // any later call mutates the shared `options` object it came from.
    const draftPayload = JSON.parse( callLog[ 1 ].payload );
    paypalTests_assertEqual_(
        draftPayload.items,
        [
            { name: 'Gift Card', quantity: '1', unit_amount: { currency_code: 'USD', value: '100.00' } },
            { name: 'Ten Raffle Tickets', quantity: '1', unit_amount: { currency_code: 'USD', value: '30.00' } },
            { name: 'Merchant Processing Surcharge Fee', quantity: '1', unit_amount: { currency_code: 'USD', value: expectedFee.surcharge.toFixed( 2 ) } }
        ],
        'The draft invoice should carry one line per winning item plus the surcharge line'
    );

    paypalTests_assertThrows_(
        function () { paypal.createAndSendInvoice( { firstName: 'Jane' }, [ { name: 'x', amount: 1 } ] ); },
        'must include an email address',
        'createAndSendInvoice should throw when bidderInfo has no email'
    );
}

function paypalTests_recordOfflinePayment_ () {
    // Bare 16-char share token gets normalized to the dashed INV2- API ID
    let callLog = [];
    let paypal = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [
            paypalTests_fakeResponse_( 200, { access_token: 'tok' } ),
            paypalTests_fakeResponse_( 200, {} )
        ], callLog )
    } );
    paypal.recordOfflinePayment( '8MZG5YJDQA37VE2R', 'cash', 42.5 );
    if ( callLog[ 1 ].url.indexOf( 'INV2-8MZG-5YJD-QA37-VE2R' ) === -1 ) {
        throw new Error( 'recordOfflinePayment should normalize a bare 16-char token into an INV2- resource ID. Got URL: ' + callLog[ 1 ].url );
    }
    const payload = JSON.parse( callLog[ 1 ].payload );
    paypalTests_assertEqual_( payload.method, 'CASH', 'recordOfflinePayment should uppercase the payment method' );
    paypalTests_assertEqual_( payload.amount, { currency_code: 'USD', value: '42.50' }, 'recordOfflinePayment should format the amount to 2 decimals' );

    // 200/202/204 all count as success; anything else does not
    [ 200, 202, 204 ].forEach( function ( status ) {
        const svc = paypalTests_newService_( {
            fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 200, { access_token: 'tok' } ), paypalTests_fakeResponse_( status, {} ) ] )
        } );
        paypalTests_assertEqual_( svc.recordOfflinePayment( 'INV2-X', 'CASH', 10 ), true, `recordOfflinePayment should treat a ${ status } response as success` );
    } );

    const failing = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 200, { access_token: 'tok' } ), paypalTests_fakeResponse_( 404, 'not found' ) ] )
    } );
    paypalTests_assertEqual_( failing.recordOfflinePayment( 'INV2-X', 'CASH', 10 ), false, 'recordOfflinePayment should treat a non-2xx response as failure' );
}

function paypalTests_getInvoiceStatus_ () {
    const paypal = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 200, { access_token: 'tok' } ), paypalTests_fakeResponse_( 200, { status: 'PAID' } ) ] )
    } );
    paypalTests_assertEqual_( paypal.getInvoiceStatus( 'INV2-X' ), 'PAID', 'getInvoiceStatus should return the status field on a 200' );

    const failing = paypalTests_newService_( {
        fetcher: paypalTests_fakeFetcher_( [ paypalTests_fakeResponse_( 200, { access_token: 'tok' } ), paypalTests_fakeResponse_( 404, 'invoice not found' ) ] )
    } );
    paypalTests_assertThrows_(
        function () { failing.getInvoiceStatus( 'INV2-X' ); },
        'PayPal Live Lookup Failed',
        'getInvoiceStatus should throw with the response body on a non-200'
    );

    paypalTests_assertThrows_(
        function () { paypalTests_newService_( {} ).getInvoiceStatus( '' ); },
        'Invoice ID is required',
        'getInvoiceStatus should throw when no invoice ID is given'
    );
}

// ── Runner ────────────────────────────────────────────────────────────────

/**
 * Runs every paypalTests_* case above and logs a PASS/FAIL summary.
 * Safe to run any time - never touches the real PayPal API or a real sheet.
 */
function runPayPalServiceUnitTests () {
    const cases = [
        [ 'extractInvoiceIdFromUrl', paypalTests_extractInvoiceIdFromUrl_ ],
        [ 'calculatePayPalSurcharge', paypalTests_calculatePayPalSurcharge_ ],
        [ 'getAccessToken_', paypalTests_getAccessToken_ ],
        [ 'createAndSendInvoice', paypalTests_createAndSendInvoice_ ],
        [ 'recordOfflinePayment', paypalTests_recordOfflinePayment_ ],
        [ 'getInvoiceStatus', paypalTests_getInvoiceStatus_ ]
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
