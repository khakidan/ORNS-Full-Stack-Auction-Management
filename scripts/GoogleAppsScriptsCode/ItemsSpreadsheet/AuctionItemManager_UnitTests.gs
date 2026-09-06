/**
 * REAL unit tests for AuctionItem's display-fallback helpers/fromData(),
 * and GoogleAIStudio._executeGeneration - runnable from the Apps Script
 * editor (select `runItemsSpreadsheetUnitTests` in the function dropdown
 * and run).
 *
 * Safe to run at any time, including against production data - nothing
 * here touches a real sheet.
 *
 * Deliberately NOT covered here: the 8 api* document-generation methods'
 * actual output (createBundlingDoc, createItemLabels, etc.) - each builds
 * a real DocumentApp/SlidesApp/DriveApp-backed document, and faithfully
 * faking those chained builder APIs for 7 different generators was judged
 * not worth the effort versus the safety it would buy. See
 * refactor-opportunities.md.
 *
 * The equivalent Node/Vitest suites (server/test/gs-items-auction-item-manager.test.ts,
 * server/test/gs-items-google-ai-studio.test.ts, server/test/itemDataService.test.ts)
 * run this exact same source file's logic inside this app's own test run -
 * use these editor-run tests when you want to sanity-check the live Apps
 * Script project directly, without a local checkout.
 */

// ── Tiny assertion helpers ───────────────────────────────────────────────

function itemsTests_assertEqual_ ( actual, expected, message ) {
    const a = JSON.stringify( actual );
    const e = JSON.stringify( expected );
    if ( a !== e ) {
        throw new Error( `${ message }\n  Expected: ${ e }\n  Actual:   ${ a }` );
    }
}

function itemsTests_itemRow_ ( id, overrides ) {
    const row = [ id, 'Food', `Item ${ id }`, 'A description', '100', '50', '5', 'A Donor', 'Physical Item', 'Active', '', '' ];
    Object.keys( overrides || {} ).forEach( function ( k ) { row[ k ] = overrides[ k ]; } );
    return row;
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

// ── AuctionItem.fromData (Code Hardening item #3) ────────────────────────

function itemsTests_fromDataReconstructsRealInstance_ () {
    const item = AuctionItem.fromData( {
        id: '301', category: 'Retail', name: 'Gift Card', description: 'A card',
        value: '100', openingBid: '50', minRaise: '5',
        donor: 'Acme Co.', itemType: 'Certificate', status: 'Active',
        bundleId: '', bundledDateTime: ''
    } );

    itemsTests_assertEqual_( item.id, '301', 'id carried through' );
    itemsTests_assertEqual_( item.category, 'Retail', 'category carried through' );
    itemsTests_assertEqual_( item.name, 'Gift Card', 'name carried through' );
    // Field-name translation: Node's resolver uses donor/itemType/bundleId/
    // bundledDateTime (src/types.ts's AuctionItem shape); this class uses
    // donatedBy/phyOrCert/bundleID/bundleTimeStamp.
    itemsTests_assertEqual_( item.donatedBy, 'Acme Co.', 'donor -> donatedBy' );
    itemsTests_assertEqual_( item.phyOrCert, 'Certificate', 'itemType -> phyOrCert' );
    itemsTests_assertEqual_( item.isLive(), false, 'reconstructed instance has real AuctionItem methods' );
}

function itemsTests_fromDataDefaultsMissingFieldsToEmptyString_ () {
    const item = AuctionItem.fromData( { id: '101' } );
    itemsTests_assertEqual_( item.category, '', 'missing category defaults to empty string' );
    itemsTests_assertEqual_( item.getDisplayValue(), '500', 'missing value still falls back to 500' );
}

// ── GoogleAIStudio._executeGeneration ────────────────────────────────────

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

// ── Runner ────────────────────────────────────────────────────────────────

function runItemsSpreadsheetUnitTests () {
    const cases = [
        [ 'AuctionItem: isLive()', itemsTests_isLive_ ],
        [ 'AuctionItem: hasOpeningBid()', itemsTests_hasOpeningBid_ ],
        [ 'AuctionItem: display fallbacks', itemsTests_displayFallbacks_ ],
        [ 'AuctionItem: short row defaults missing trailing cells to \'\'', itemsTests_shortRowDefaultsMissingTrailingCellsToEmptyString_ ],
        [ 'AuctionItem.fromData: reconstructs a real instance', itemsTests_fromDataReconstructsRealInstance_ ],
        [ 'AuctionItem.fromData: defaults missing fields to \'\'', itemsTests_fromDataDefaultsMissingFieldsToEmptyString_ ],
        [ '_executeGeneration: success', itemsTests_executeGeneration_success_ ],
        [ '_executeGeneration: catches errors', itemsTests_executeGeneration_catchesErrors_ ]
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
