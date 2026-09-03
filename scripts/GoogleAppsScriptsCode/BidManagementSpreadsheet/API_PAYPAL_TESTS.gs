/**
 * LOCAL API TESTING SUITE
 * Run these functions from the Apps Script editor toolbar to verify the API bridge locally.
 */

/**
 * Tests the individual receipt generation pipeline.
 * Simulates: { "bidderId": 101, "emailReceipt": false }
 */
function testApiCreateIndividualReceipt () {
    // UPDATE THIS to a valid Bidder ID from your sheet who has won items
    const testBidderId = 101;
    const sendEmailFlag = false; // Set to true to also test the email dispatch

    Logger.log( `--- Testing apiCreateIndividualReceipt ---` );
    Logger.log( `Target Bidder: ${ testBidderId } | Send Email: ${ sendEmailFlag }` );

    const result = apiCreateIndividualReceipt( testBidderId, sendEmailFlag );

    Logger.log( `API Response:` );
    Logger.log( JSON.stringify( result, null, 2 ) );

    if ( result.success ) {
        Logger.log( `✅ SUCCESS! Document created: ${ result.docId }` );
        Logger.log( `✅ Invoice URL: ${ result.paymentUrl }` );
    } else {
        Logger.log( `❌ FAILED: ${ result.error }` );
    }
}

/**
 * Tests the individual email dispatch endpoint.
 * Simulates: { "bidderId": 101 }
 */
function testApiSendReceiptEmail () {
    // UPDATE THIS to a valid Bidder ID from your sheet who has won items
    const testBidderId = 101;

    Logger.log( `--- Testing apiSendReceiptEmail ---` );
    Logger.log( `Target Bidder: ${ testBidderId }` );
    Logger.log( `Make sure the email address for this bidder in your sheet is safe/yours!` );

    const result = apiSendReceiptEmail( testBidderId );

    Logger.log( `API Response:` );
    Logger.log( JSON.stringify( result, null, 2 ) );

    if ( result.success ) {
        Logger.log( `✅ SUCCESS! Email dispatched.` );
    } else {
        Logger.log( `❌ FAILED: ${ result.error }` );
    }
}

/**
 * Tests the batch document generator.
 * WARNING: This will process every winning bidder in the sheet.
 */
function testApiCreateAllReceipts () {
    Logger.log( `--- Testing apiCreateAllReceipts (Batch Document Generation) ---` );
    Logger.log( `Initializing batch run. This may take several minutes...` );

    const start = new Date().getTime();
    const result = apiCreateAllReceipts();
    const end = new Date().getTime();

    Logger.log( `API Response:` );
    Logger.log( JSON.stringify( result, null, 2 ) );

    if ( result.success ) {
        Logger.log( `✅ SUCCESS! Batch process completed in ${ ( end - start ) / 1000 } seconds.` );
    } else {
        Logger.log( `❌ FAILED: ${ result.error }` );
    }
}

/**
 * Tests the batch email generator.
 * WARNING: This will create invoices and send emails to every winning bidder in the sheet.
 */
function testApiSendAllEmails () {
    Logger.log( `--- Testing apiSendAllEmails (Batch Email Dispatch) ---` );
    Logger.log( `Initializing batch run. Emails are being sent...` );

    const start = new Date().getTime();
    const result = apiSendAllEmails();
    const end = new Date().getTime();

    Logger.log( `API Response:` );
    Logger.log( JSON.stringify( result, null, 2 ) );

    if ( result.success ) {
        Logger.log( `✅ SUCCESS! Mass email process completed in ${ ( end - start ) / 1000 } seconds.` );
    } else {
        Logger.log( `❌ FAILED: ${ result.error }` );
    }
}

/**
 * Local test function to verify PayPal credentials and invoice generation
 * Run this directly from the Apps Script Editor.
 */
function testPayPalIntegration () {
    Logger.log( "--- Starting Local PayPal Test ---" );

    try {
        // 1. Instantiate the service
        const paypal = new PayPalService();
        Logger.log( "1. Initialization Successful." );
        Logger.log( `   - Sandbox Mode: ${ paypal.isSandbox }` );
        Logger.log( `   - Base URL: ${ paypal.baseUrl }` );
        Logger.log( `   - Client ID Loaded: ${ !!paypal.clientId }` );
        Logger.log( `   - Client Secret Loaded: ${ !!paypal.clientSecret }` );

        // 2. Test Authentication (This catches the "Missing credentials" error)
        Logger.log( "2. Testing Authentication..." );
        const token = paypal.getAccessToken_();
        Logger.log( `   - SUCCESS! Token retrieved (Starts with: ${ token.substring( 0, 10 ) }...)` );

        // 3. Test Surcharge Math
        Logger.log( "3. Testing Surcharge Math ($100.00 bid)..." );
        const mathTest = paypal.calculatePayPalSurcharge( 100.00 );
        Logger.log( `   - Original: $100.00` );
        Logger.log( `   - Surcharge: $${ mathTest.surcharge }` );
        Logger.log( `   - Total Expected: $${ mathTest.total }` );

        // 4. Test Invoice Creation (This catches the 400 Bad Request/URL error)
        Logger.log( "4. Testing Invoice Generation (Creating a $1.00 dummy invoice)..." );
        const dummyBidderInfo = {
            email: 'test-buyer@example.com',
            firstName: 'Test',
            lastName: 'Buyer',
            id: '999'
        };
        const dummyLineItems = [ { name: 'Test Auction Item', amount: 1.00 }, { name: 'Test Auction Item', amount: 1.00 } ];

        const invoiceResult = paypal.createAndSendInvoice( dummyBidderInfo, dummyLineItems );
        Logger.log( "   - SUCCESS! Invoice generated." );
        Logger.log( `   - Invoice ID: ${ invoiceResult.invoiceId }` );
        Logger.log( `   - Total Amount (with fee): $${ invoiceResult.totalAmount }` );
        Logger.log( `   - Checkout URL: ${ invoiceResult.checkoutUrl }` );

    } catch ( error ) {
        Logger.log( "!!! TEST FAILED !!!" );
        Logger.log( `Error Message: ${ error.message }` );
        if ( error.stack ) {
            Logger.log( `Stack Trace: ${ error.stack }` );
        }
    }
}

/**
 * Tests the payment recording pipeline end-to-end.
 *
 * BEFORE RUNNING:
 *   1. Set testBidderId to a bidder who already has an invoice URL in Column J
 *      (run testApiCreateIndividualReceipt first if needed).
 *   2. Set testPaymentMethod to the method you want to test.
 *   3. Note: running this with 'cash' or 'check' will CLOSE the PayPal invoice
 *      as paid — use a sandbox bidder.
 */
function testApiRecordPayment () {
    const testBidderId = '101';       // ← update to a valid bidder with an existing invoice
    const testPaymentMethod = 'credit_card';     // ← 'cash' | 'check' | 'credit_card'

    Logger.log( `--- Testing apiRecordPayment ---` );
    Logger.log( `Bidder: ${ testBidderId } | Method: ${ testPaymentMethod }` );

    const result = apiRecordPayment( testBidderId, testPaymentMethod );

    Logger.log( 'API Response:' );
    Logger.log( JSON.stringify( result, null, 2 ) );

    if ( result.success ) {
        Logger.log( `✅ SUCCESS! Sheet updated.` );
        Logger.log( `   PayPal invoice closed via API: ${ result.paypalRecorded }` );
        if ( !result.paypalRecorded ) {
            Logger.log( `   ℹ️  PayPal was not called — either credit card method or no invoice on file.` );
        }
    } else {
        Logger.log( `❌ FAILED: ${ result.error }` );
    }
}

/**
 * ==============================================================================
 * INTEGRATION TEST SUITE
 * Run these functions to verify PayPalService, GoogleAIStudio, and the CRON Job.
 * View outputs in the "Executions" tab of your Apps Script editor.
 * ==============================================================================
 */

// ⚠️ IMPORTANT: Change this to a real Bidder ID that exists in your sheets and has winning bids!
const TEST_BIDDER_ID = "108";

/**
 * 1. TEST THE PAYPAL SERVICE CLASS DIRECTLY
 * This tests your API credentials, math calculations, and invoice lifecycle.
 */
function testPayPalServiceClass () {
    console.log( "=== STARTING PAYPAL SERVICE TESTS ===" );
    try {
        const paypal = new PayPalService();
        console.log( "✅ PayPalService initialized successfully." );
        console.log( `⚙️  Mode: ${ paypal.isSandbox ? "SANDBOX" : "LIVE" }` );

        // Test Token
        console.log( "--- 1. Testing OAuth Token Retrieval ---" );
        const token = paypal.getAccessToken_();
        console.log( `✅ Access Token Retrieved (Hidden for security, length: ${ token.length })` );

        // Test Surcharge Calculation
        console.log( "--- 2. Testing Surcharge Calculation ---" );
        const bidAmount = 100.00;
        const feeData = paypal.calculatePayPalSurcharge( bidAmount );
        console.log( `✅ Math Test ($100 bid) -> Total Invoice: $${ feeData.total }, Added Surcharge: $${ feeData.surcharge }` );

        // Test Invoice Creation
        console.log( "--- 3. Testing Invoice Creation ---" );
        const testBidderInfo = {
            email: "test-buyer@example.com", // use a valid email format
            firstName: "Lana",
            lastName: "Finnegan",
            id: "108"
        };
        const testLineItems = [
            { name: "Test Auction Item 1", amount: 50.00 },
            { name: "Test Auction Item 2", amount: 50.00 }
        ];

        const invoiceResult = paypal.createAndSendInvoice( testBidderInfo, testLineItems );
        console.log( `✅ Invoice Created on PayPal!` );
        console.log( `   ➔ Invoice ID: ${ invoiceResult.invoiceId }` );
        console.log( `   ➔ Checkout URL: ${ invoiceResult.checkoutUrl }` );
        console.log( `   ➔ Total Amount w/ Fees: $${ invoiceResult.totalAmount }` );

        // Test Get Invoice Status
        console.log( "--- 4. Testing Invoice Status Retrieval ---" );
        const status = paypal.getInvoiceStatus( invoiceResult.invoiceId );
        console.log( `✅ Invoice Status is currently: ${ status }` ); // Expected: 'SENT' or 'UNPAID'

        // Test URL Extraction
        console.log( "--- 5. Testing URL Parsing ---" );
        const parsedId = paypal.extractInvoiceIdFromUrl( invoiceResult.checkoutUrl );
        console.log( `✅ Parsed ID from Checkout URL: ${ parsedId } (Match: ${ parsedId === invoiceResult.invoiceId })` );

        // Test Invoice Cancellation
        console.log( "--- 6. Testing Invoice Cancellation ---" );
        paypal.cancelInvoice( invoiceResult.invoiceId );
        console.log( "✅ Invoice Cancelled Successfully (Check your PayPal sandbox dashboard to verify)." );

    } catch ( error ) {
        console.error( `❌ PAYPAL TEST FAILED: ${ error.message }` );
        console.error( error.stack );
    }
    console.log( "=== END PAYPAL SERVICE TESTS ===" );
}

/**
 * 2. TEST THE GOOGLE AI STUDIO BRIDGE CLASS
 * This tests the external API entry points that rely on the ReceiptManager and CheckOutManager.
 */
function testGoogleAIStudioClass () {
    console.log( "=== STARTING GOOGLE AI STUDIO TESTS ===" );
    const aiStudio = new GoogleAIStudio();

    console.log( `--- 1. Testing createIndividualReceipt() for Bidder ID: ${ TEST_BIDDER_ID } ---` );
    try {
        // Attempt to generate a receipt document + paypal link without emailing it
        const receiptResult = aiStudio.createIndividualReceipt( TEST_BIDDER_ID, false, null );
        console.log( "📦 API Response Payload:", JSON.stringify( receiptResult, null, 2 ) );

        if ( receiptResult.success ) {
            console.log( `✅ Successfully generated Receipt PDF ID: ${ receiptResult.docId }` );
            console.log( `✅ PayPal Checkout URL generated: ${ receiptResult.paymentUrl }` );
            console.log( `✅ Subtotal expected: $${ receiptResult.subtotal }` );
        } else {
            console.error( `❌ Receipt generation rejected: ${ receiptResult.error }` );
        }
    } catch ( error ) {
        console.error( `❌ CREATE RECEIPT PIPELINE FAILED: ${ error.message }` );
    }

    console.log( `\n--- 2. Testing recordPayment() for Bidder ID: ${ TEST_BIDDER_ID } ---` );
    try {
        // Testing an offline payment to see if it marks the PayPal invoice as 'PAID' via recordOfflinePayment
        const paymentMethod = 'credit_card';
        const paymentResult = aiStudio.recordPayment( TEST_BIDDER_ID, paymentMethod );
        console.log( "📦 API Response Payload:", JSON.stringify( paymentResult, null, 2 ) );

        if ( paymentResult.success ) {
            console.log( `✅ Successfully updated 'Bidder-Numbers' sheet for ${ TEST_BIDDER_ID }.` );
            console.log( `✅ PayPal External API ledger updated: ${ paymentResult.paypalRecorded }` );
        } else {
            console.error( `❌ Payment recording rejected: ${ paymentResult.error }` );
        }
    } catch ( error ) {
        console.error( `❌ RECORD PAYMENT PIPELINE FAILED: ${ error.message }` );
    }

    console.log( "=== END GOOGLE AI STUDIO TESTS ===" );
}

/**
 * 3. TEST THE CRON JOB SWEEPER (checkPendingPayPalInvoices)
 * Simulates a real checkout event, then triggers the background sweeper to verify 
 * if a "PAID" status correctly checks off rows and updates tracking cells.
 */
function testCronJobSweeper () {
    console.log( "=== STARTING CRON JOB SWEEPER TEST ===" );

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName( 'Bidder-Numbers' );
    if ( !sheet ) {
        console.error( "❌ 'Bidder-Numbers' sheet not found! Cannot run test." );
        return;
    }

    // 1. Setup Dummy Injection
    console.log( "--- 1. Injecting dummy 'Pending' row into sheet ---" );
    const lastRow = sheet.getLastRow();
    const testRowIndex = lastRow + 1;

    const mockBidderId = "108";

    // Extracting the alphanumeric suffix from your screenshot invoice: "H38U-JGHJ-F3UZ-HLX3"
    const rawIdSuffix = "H38U-JGHJ-F3UZ-HLX3";

    // ✅ FIX: Formulate URL with lowercase "inv-" to satisfy your production engine's matching logic
    const mockUrl = `https://www.sandbox.paypal.com/invoice/p/#inv-${ rawIdSuffix }`;

    // Inject precisely where checkPendingPayPalInvoices expects to poll data
    sheet.getRange( testRowIndex, 1 ).setValue( mockBidderId );                      // Col A: ID
    sheet.getRange( testRowIndex, 9 ).setValue( "PayPal Verification Pending" );     // Col I: Status 
    sheet.getRange( testRowIndex, 10 ).setValue( mockUrl );                          // Col J: URL Anchor
    sheet.getRange( testRowIndex, 11 ).setValue( 207.74 );                           // Col K: Total Amount Due
    sheet.getRange( testRowIndex, 12 ).setValue( new Date().toISOString() );         // Col L: Processing Timestamp

    console.log( `✅ Injected test row ${ testRowIndex } using formatted link pattern: ${ mockUrl }` );
    SpreadsheetApp.flush(); // Commit data to cells

    // 2. Trigger Sweeper
    console.log( "--- 2. Executing checkPendingPayPalInvoices() ---" );
    try {
        checkPendingPayPalInvoices();
        console.log( "✅ checkPendingPayPalInvoices() executed cleanly." );
    } catch ( error ) {
        console.error( `❌ CRON JOB EXECUTION FAILED: ${ error.message }` );
    }

    // 3. Verify Reconciliation Fields
    console.log( "--- 3. Verifying Spreadsheet Cell Reconciliation ---" );
    SpreadsheetApp.flush();

    const isPaidField = sheet.getRange( testRowIndex, 7 ).getValue();        // Col G
    const isCheckedOutField = sheet.getRange( testRowIndex, 8 ).getValue();   // Col H
    const settlementMethod = sheet.getRange( testRowIndex, 9 ).getValue();    // Col I
    const trailingTimestamp = sheet.getRange( testRowIndex, 12 ).getValue();  // Col L

    console.log( `📊 Post-Run Cell State Analysis:` );
    console.log( `   ➔ Col G (Paid?):        ${ isPaidField }   (Expected: true)` );
    console.log( `   ➔ Col H (Checked Out?): ${ isCheckedOutField }   (Expected: true)` );
    console.log( `   ➔ Col I (Method Label): "${ settlementMethod }" (Expected: "Credit Card / PayPal")` );
    console.log( `   ➔ Col L (Timestamp):    "${ trailingTimestamp }" (Expected: Clear / Empty)` );

    if ( isPaidField === true && settlementMethod === "Credit Card / PayPal" ) {
        console.log( "🎉 SUCCESS: The background engine successfully found the invoice, confirmed payment, and checked off the row!" );
    } else {
        console.log( "ℹ️ Status remained Pending/Unchanged. Ensure invoice 'INV2-H38U-JGHJ-F3UZ-HLX3' is marked PAID in your sandbox dashboard." );
    }

    // 4. Clean up the sheet
    console.log( "--- 4. Cleaning up test matrix row ---" );
    sheet.deleteRow( testRowIndex );
    console.log( "✅ Row entry cleanly scrubbed from 'Bidder-Numbers'." );

    console.log( "=== END CRON JOB SWEEPER TEST ===" );
}