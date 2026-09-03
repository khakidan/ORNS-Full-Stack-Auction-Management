/**
 * Service class to handle OAuth authentication and Itemized Invoicing via PayPal v2 API.
 * Uses the exact structural parsing logic validated in the direct pipeline test.
 */
class PayPalService {
    constructor () {
        const props = PropertiesService.getScriptProperties();
        const allProps = props.getProperties(); // Fetch all keys at once to prevent individual null hits

        // Clean keys of any hidden trailing spaces from the Google Cloud console copy/paste
        this.clientId = ( allProps[ 'PAYPAL_CLIENT_ID' ] || '' ).trim();
        this.clientSecret = ( allProps[ 'PAYPAL_CLIENT_SECRET' ] || '' ).trim();

        const sandboxRaw = ( allProps[ 'PAYPAL_IS_SANDBOX' ] || '' ).trim().toLowerCase();
        this.isSandbox = sandboxRaw === 'true' || sandboxRaw === ''; // Default to true if empty/sandbox

        this.baseUrl = this.isSandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
        this.merchantEmail = 'pavetheway@orns.org';

        console.log( `PayPal Config Initialized. Sandbox: ${ this.isSandbox }, Has Client ID: ${ !!this.clientId }, Has Secret: ${ !!this.clientSecret }` );
    }

    /**
     * Generates OAuth2 Access Token for API authorization requests.
     * @private
     */
    getAccessToken_ () {
        if ( !this.clientId || !this.clientSecret ) {
            throw new Error( "Missing PayPal credentials in your Script Properties Settings!" );
        }
        const authString = Utilities.base64Encode( `${ this.clientId }:${ this.clientSecret }` );
        const options = {
            method: 'post',
            headers: { 'Authorization': `Basic ${ authString }` },
            payload: { 'grant_type': 'client_credentials' },
            muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch( `${ this.baseUrl }/v1/oauth2/token`, options );
        if ( response.getResponseCode() !== 200 ) {
            throw new Error( `PayPal API Authentication Failed: ${ response.getContentText() }` );
        }
        return JSON.parse( response.getContentText() ).access_token;
    }

    /**
     * Calculates the exact total invoice amount using the non-profit safe rate (3.49% + $0.49).
     * This is the source of truth for all fee calculations — the result written to Column K
     * and the total shown on the PayPal invoice are both derived from this method.
     * @param {number} bidAmount  The raw subtotal the bidder owes (cash/check amount).
     * @returns {{ total: number, surcharge: number }}
     */
    calculatePayPalSurcharge ( bidAmount ) {
        const percentRate = 0.0349;
        const fixedFee = 0.49;
        const totalInvoiceAmount = ( bidAmount + fixedFee ) / ( 1 - percentRate );

        const roundedTotal = Math.round( totalInvoiceAmount * 100 ) / 100;
        const surchargeAmount = Math.round( ( roundedTotal - bidAmount ) * 100 ) / 100;

        return {
            total: roundedTotal,
            surcharge: surchargeAmount
        };
    }

    /**
     * Parses the PayPal Invoice ID out of a checkout URL stored in Column J.
     *
     * PayPal invoice URLs take one of two shapes:
     *   https://www.sandbox.paypal.com/invoice/p/#INV2-XXXX-XXXX-XXXX-XXXX
     *   https://www.paypal.com/invoice/p/#INV2-XXXX-XXXX-XXXX-XXXX
     *
     * The fragment after the # is exactly the invoice ID the v2 API accepts
     * for cancel, record-payment, etc.
     *
     * @param {string} url  The checkout URL stored in Column J.
     * @returns {string|null}  The invoice ID, or null if it cannot be parsed.
     */
    extractInvoiceIdFromUrl ( url ) {
        if ( !url || typeof url !== 'string' ) return null;

        // Primary path: ID is the URL fragment (everything after #)
        const hashIndex = url.indexOf( '#' );
        if ( hashIndex !== -1 ) {
            const fragment = url.substring( hashIndex + 1 ).trim();
            if ( fragment.length > 0 ) return fragment;
        }

        // Fallback: take the last non-empty path segment
        // (handles any future URL shape that drops the fragment)
        const parts = url.split( '/' ).filter( p => p.length > 0 );
        return parts.length > 0 ? parts[ parts.length - 1 ] : null;
    }

    /**
     * Builds an active invoice on PayPal with one line per winning item, appends
     * the processing surcharge as its own line, sends it, and returns the payment link.
     *
     * @param {{ email: string, firstName: string, lastName: string, id: string|number }} bidderInfo
     *   All identifying details for the invoice recipient.
     * @param {{ name: string, amount: number }[]} lineItems
     *   Individual winning items, e.g.:
     *   [{ name: 'Ten Raffle Tickets', amount: 30 }, { name: 'Gorjana Gift Card', amount: 150 }]
     *   Amounts must be raw cash/check prices — the fee is calculated and appended here.
     * @returns {{ invoiceId: string, totalAmount: number, checkoutUrl: string }}
     */
    createAndSendInvoice ( bidderInfo, lineItems ) {
        if ( !bidderInfo || !bidderInfo.email ) {
            throw new Error( 'createAndSendInvoice: bidderInfo must include an email address.' );
        }
        if ( !Array.isArray( lineItems ) || lineItems.length === 0 ) {
            throw new Error( 'createAndSendInvoice: lineItems must be a non-empty array.' );
        }

        const token = this.getAccessToken_();

        // Derive the total bid amount by summing the individual line items
        const bidAmount = lineItems.reduce( ( sum, item ) => sum + ( Number( item.amount ) || 0 ), 0 );
        const feeData = this.calculatePayPalSurcharge( bidAmount );

        // Build one PayPal invoice item per winning item, then append the surcharge line
        const invoiceItems = lineItems.map( item => ( {
            name: item.name,
            quantity: '1',
            unit_amount: { currency_code: 'USD', value: Number( item.amount ).toFixed( 2 ) }
        } ) );

        invoiceItems.push( {
            name: 'Merchant Processing Surcharge Fee',
            quantity: '1',
            unit_amount: { currency_code: 'USD', value: feeData.surcharge.toFixed( 2 ) }
        } );

        const invoicePayload = {
            detail: {
                currency_code: 'USD',
                // 'reference' is a labeled field on the rendered PayPal invoice — ideal for bidder ID
                reference: `Bidder #${ bidderInfo.id }`,
                note: 'Thank you for supporting our school charity auction! A standard merchant processing fee has been added to ensure 100% of your winning bids go directly to our programs.'
            },
            invoicer: { email_address: this.merchantEmail },
            primary_recipients: [ {
                billing_info: {
                    name: {
                        given_name: bidderInfo.firstName,
                        surname: bidderInfo.lastName
                    },
                    email_address: bidderInfo.email,
                    additional_info: `Bidder ID: ${ bidderInfo.id }`
                }
            } ],
            items: invoiceItems
        };

        let options = {
            method: 'post',
            contentType: 'application/json',
            headers: { 'Authorization': `Bearer ${ token }` },
            payload: JSON.stringify( invoicePayload ),
            muteHttpExceptions: true
        };

        // Step A: Draft the invoice
        let response = UrlFetchApp.fetch( `${ this.baseUrl }/v2/invoicing/invoices`, options );
        let responseText = response.getContentText();
        let invoiceData = JSON.parse( responseText );

        // HARDENED ID EXTRACTION: root property first, then href fallback
        let invoiceId = invoiceData.id;
        if ( !invoiceId && invoiceData.href ) {
            const parts = invoiceData.href.split( '/' );
            invoiceId = parts[ parts.length - 1 ];
        }

        if ( !invoiceId ) {
            throw new Error( `Invoice failed to build. Status: ${ response.getResponseCode() }, Body: ${ responseText }` );
        }

        // Step B: Send/publish so it registers on the payment ledger
        options.method = 'post';
        options.payload = JSON.stringify( { send_to_recipient: true } );
        response = UrlFetchApp.fetch( `${ this.baseUrl }/v2/invoicing/invoices/${ invoiceId }/send`, options );

        // Step C: Extract the checkout URL
        let sendData = {};
        try {
            sendData = JSON.parse( response.getContentText() );
        } catch ( e ) {
            // PayPal sometimes returns an empty body on 202/204
        }

        const payerLink = sendData.links ? sendData.links.find( l => l.rel === 'payer-action' ) : null;
        const checkoutUrl = payerLink ? payerLink.href : ( this.isSandbox
            ? `https://www.sandbox.paypal.com/invoice/p/#${ invoiceId }`
            : `https://www.paypal.com/invoice/p/#${ invoiceId }` );

        return {
            invoiceId: invoiceId,
            totalAmount: feeData.total,
            checkoutUrl: checkoutUrl
        };
    }

    /**
     * Destroys an existing outdated invoice link to prevent accidental underpayment.
     * @param {string} invoiceId  The bare PayPal invoice ID (e.g. INV2-XXXX-XXXX-XXXX-XXXX).
     */
    cancelInvoice ( invoiceId ) {
        const token = this.getAccessToken_();
        const options = {
            method: 'post',
            contentType: 'application/json',
            headers: { 'Authorization': `Bearer ${ token }` },
            payload: JSON.stringify( {
                subject: 'Invoice Updated',
                note: 'Your item cart balance changed. This old link has been disabled and replaced with an updated one.',
                send_to_recipient: false
            } ),
            muteHttpExceptions: true
        };
        UrlFetchApp.fetch( `${ this.baseUrl }/v2/invoicing/invoices/${ invoiceId }/cancel`, options );
    }

    /**
     * Internal ledger tool to process offline cash/check payments.
     * @param {string} invoiceId
     * @param {string} paymentMethod  'CASH' or 'CHECK'
     * @param {number} totalAmount
     * @returns {boolean}
     */
    recordOfflinePayment ( invoiceId, paymentMethod, totalAmount ) {
        console.log( `[PayPal Debug] ─── START OF RECORD PAYMENT ENTRY ───` );
        console.log( `[PayPal Debug] Arguments passed -> ID: "${ invoiceId }", Method: "${ paymentMethod }", Amount: ${ totalAmount }` );

        // AUTO-CONVERT: Convert public share token (8MZG5YJDQA37VE2R) to API Resource ID (INV2-8MZG-5YJD-QA37-VE2R)
        let apiInvoiceId = invoiceId ? invoiceId.trim() : "";
        if ( apiInvoiceId && !apiInvoiceId.toUpperCase().startsWith( "INV2-" ) && apiInvoiceId.length === 16 ) {
            const chunks = apiInvoiceId.match( /.{1,4}/g );
            if ( chunks && chunks.length === 4 ) {
                apiInvoiceId = "INV2-" + chunks.join( "-" ).toUpperCase();
                console.log( `[PayPal Debug] Converted frontend hash token into full REST API ID: ${ apiInvoiceId }` );
            }
        }

        const token = this.getAccessToken_();

        const payload = {
            method: paymentMethod.toUpperCase(), // 'CASH' or 'CHECK'
            payment_date: new Date().toISOString().split( 'T' )[ 0 ], // YYYY-MM-DD
            amount: {
                currency_code: 'USD',
                value: Number( totalAmount ).toFixed( 2 )
            }
        };

        console.log( `[PayPal Debug] Outgoing Payload Body: ${ JSON.stringify( payload ) }` );

        const options = {
            method: 'post',
            contentType: 'application/json',
            headers: { 'Authorization': `Bearer ${ token }` },
            payload: JSON.stringify( payload ),
            muteHttpExceptions: true
        };

        const url = `${ this.baseUrl }/v2/invoicing/invoices/${ apiInvoiceId }/payments`;
        console.log( `[PayPal Debug] Outgoing Request Endpoint: ${ url }` );

        // Execute request
        const response = UrlFetchApp.fetch( url, options );
        const statusCode = response.getResponseCode();
        const responseText = response.getContentText();

        console.log( `[PayPal Debug] Response Status Code received: ${ statusCode }` );
        console.log( `[PayPal Debug] Response Payload body: ${ responseText }` );

        // PayPal returns an HTTP 200 OK along with a payment history reference payload when successful
        const isSuccess = statusCode === 200 || statusCode === 202 || statusCode === 204;
        console.log( `[PayPal Debug] Verification check passed: ${ isSuccess }` );
        console.log( `[PayPal Debug] ─── END OF RECORD PAYMENT ENTRY ───` );

        return isSuccess;
    }

    /**
 * Fetches the current live status of an invoice directly from the PayPal API.
 * @param {string} invoiceId The PayPal Invoice ID to verify.
 * @return {string} The status of the invoice (e.g., 'PAID', 'SENT', 'UNPAID').
 */
    getInvoiceStatus ( invoiceId ) {
        if ( !invoiceId ) throw new Error( "Invoice ID is required to fetch status." );

        const accessToken = this.getAccessToken_();
        const url = `${ this.baseUrl }/v2/invoicing/invoices/${ invoiceId }`;

        const options = {
            method: 'get',
            headers: {
                'Authorization': `Bearer ${ accessToken }`,
                'Content-Type': 'application/json'
            },
            muteHttpExceptions: true
        };

        const response = UrlFetchApp.fetch( url, options );
        const responseCode = response.getResponseCode();
        const responseText = response.getContentText();

        if ( responseCode !== 200 ) {
            throw new Error( `PayPal Live Lookup Failed (${ responseCode }): ${ responseText }` );
        }

        const data = JSON.parse( responseText );
        return data.status;
    }
}