/**
 * Background Cron Loop bound to Time-Driven Trigger.
 * Scans for provisional checkouts, reconciles statuses via PayPal,
 * or escalates failures to the PayPal-Follow-Up destination.
 *
 * Deliberately not the client-facing "Follow-Up" sheet (Class_GoogleAIStudio.gs's
 * recordWinningBid path / the Dashboard's Post-Checkout Item Wins panel),
 * which owns a different, incompatible 3-column schema
 * (["Bidder ID","Item ID","Amount"]). The two used to collide on the same
 * sheet name with different headers - whichever wrote first "won" the
 * header, and the other's appends landed under the wrong columns.
 *
 * @param {Object} [overrides] Optional dependency injection, used by unit
 *   tests. The real trigger always calls this with zero args.
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [overrides.activeSpreadSheet]
 *   Replaces `SpreadsheetApp.getActiveSpreadsheet()`.
 * @param {Object} [overrides.paypalService] Replaces `new PayPalService()`.
 * @param {number} [overrides.now] Replaces `new Date().getTime()` - lets
 *   tests control the 10-minute escalation threshold deterministically.
 */
function checkPendingPayPalInvoices ( overrides = {} ) {
    const ss = overrides.activeSpreadSheet || SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName( 'Bidder-Numbers' );
    if ( !sheet ) {
        console.error( "Sweeper missing target tab execution anchor: 'Bidder-Numbers'" );
        return;
    }

    const data = sheet.getDataRange().getValues();
    const now = overrides.now !== undefined ? overrides.now : new Date().getTime();
    const TEN_MINUTES_MS = 10 * 60 * 1000;

    let paypal = overrides.paypalService || null;
    if ( !paypal ) {
        try {
            paypal = new PayPalService();
        } catch ( e ) {
            console.error( "Failed to initialize PayPal service engine for background sweeping: " + e.message );
            return;
        }
    }

    // Evaluate sheet rows bottom-up to preserve safety during potential row operations
    for ( let i = data.length - 1; i >= 1; i-- ) {
        const methodLabel = data[ i ][ 8 ]; // Column I (0-indexed 8)

        if ( methodLabel === "PayPal Verification Pending" ) {
            const bidderId = data[ i ][ 0 ];       // Column A (0)
            const firstName = data[ i ][ 1 ];      // Column B (1)
            const lastName = data[ i ][ 2 ];       // Column C (2)
            const amountDue = data[ i ][ 10 ];     // Column K (10) -> Total Invoice Amount
            const invoiceUrlCell = data[ i ][ 9 ]; // Column J (9)  -> Invoice URL
            const timestampStr = data[ i ][ 11 ];  // Column L (11) -> Checkout Timestamp
            const rowNumber = i + 1;

            // Parse out Invoice ID from link reference. Uses PayPalService's
            // shared extractor (handles both production "#INV2-..." and
            // sandbox "#inv-..." URL shapes) instead of a narrower inline
            // regex that only matched the sandbox format and silently
            // skipped every production row.
            const invoiceId = paypal.extractInvoiceIdFromUrl( invoiceUrlCell );

            if ( !invoiceId ) {
                console.warn( `Row ${ rowNumber }: Flagged pending but missing evaluable Invoice ID extraction pattern.` );
                continue;
            }

            try {
                // Poll PayPal Live state status
                const currentLiveStatus = paypal.getInvoiceStatus( invoiceId );
                console.log( `Sweeper polling Bidder #${ bidderId } (${ lastName }) -> PayPal status: ${ currentLiveStatus }` );

                // ✅ FIX: Accept both standard credit card 'PAID' and manual 'MARKED_AS_PAID' states
                if ( currentLiveStatus === "PAID" || currentLiveStatus === "MARKED_AS_PAID" ) {
                    // Success resolution
                    sheet.getRange( rowNumber, 7 ).setValue( true );  // Column G: Checked Out? -> Checked
                    sheet.getRange( rowNumber, 8 ).setValue( true );  // Column H: Paid? -> Checked
                    sheet.getRange( rowNumber, 9 ).setValue( "Credit Card / PayPal" ); // Column I
                    sheet.getRange( rowNumber, 12 ).clearContent(); // Column L: Clear timestamp
                    console.log( `Bidder #${ bidderId } reconciled successfully via background sweeper.` );

                } else {
                    // Evaluate expiration threshold if still unpaid
                    let initTime = 0;
                    if ( timestampStr ) {
                        initTime = new Date( timestampStr ).getTime();
                    }

                    if ( initTime === 0 || isNaN( initTime ) ) {
                        // Fallback safety if timestamp cell blank: seed it right now
                        sheet.getRange( rowNumber, 12 ).setValue( new Date().toISOString() );
                        continue;
                    }

                    if ( now - initTime > TEN_MINUTES_MS ) {
                        // EXPIRED: Escalation routing path triggered
                        console.warn( `Bidder #${ bidderId } verification processing exceeded timeout limits. Shunting record to PayPal-Follow-Up.` );

                        let followUpSheet = ss.getSheetByName( 'PayPal-Follow-Up' );
                        if ( !followUpSheet ) {
                            followUpSheet = ss.insertSheet( 'PayPal-Follow-Up' );
                            followUpSheet.appendRow( [ "Timestamp", "Bidder Number", "Name", "Amount Flagged", "Invoice URL", "System Notes" ] );
                            followUpSheet.getRange( "A1:F1" ).setFontWeight( "bold" ).setBackground( "#f4cbcb" );
                        }

                        // Append historical log entry tracking anomaly context
                        const nameString = `${ firstName } ${ lastName }`.trim();
                        followUpSheet.appendRow( [
                            new Date(),
                            bidderId,
                            nameString,
                            amountDue,
                            invoiceUrlCell,
                            `PayPal timeout error. Terminal status remained: '${ currentLiveStatus }' after 10 minutes checking execution window.`
                        ] );

                        // Update source row state marking complete-fault variant
                        sheet.getRange( rowNumber, 7 ).setValue( false ); // G: Checked out stays false
                        sheet.getRange( rowNumber, 8 ).setValue( false ); // H: Paid stays false
                        sheet.getRange( rowNumber, 9 ).setValue( "Failed Verification - Follow Up Required" ); // Column I
                        sheet.getRange( rowNumber, 12 ).clearContent(); // Column L: Clear timestamp
                    }
                }
            } catch ( rowErr ) {
                console.error( `Error processing sweep iteration on row ${ rowNumber }: ${ rowErr.message }` );
            }
        }
    }
}