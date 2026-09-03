/**
 * Data manager. Extends GlobalStyles so it can reference font and color
 * constants when building the HTML email body.
 *
 * Responsibilities:
 *   - Build an Email data model from a Receipt
 *   - Send the email via GmailApp
 *
 * EmailLetter is NOT a separate class for this script — emails are sent
 * via GmailApp with an in-memory HTML string, not written to a Drive file.
 * All email generation therefore lives here.
 */
class EmailManager extends GlobalStyles {
    constructor () {
        super();
        this.senderName = 'Orchard Ridge Nursery School';
        this.senderEmail = 'info@orns.org';
    }

    /**
     * Builds an Email data model for the given receipt.
     * @param {Receipt} receipt
     * @param {string}  paymentUrl
     * @param {string}  adjustedTotal
     * @param {string}  feeAmount
     * @returns {Email}
     */
    buildReceiptEmail ( receipt, paymentUrl, adjustedTotal, feeAmount ) {
        const subject = `Your Auction Receipt: ${ receipt.getDisplayName() }`;
        const htmlBody = this._generateHtmlTemplate_( receipt, paymentUrl, adjustedTotal, feeAmount );
        return new Email( receipt.email, subject, htmlBody, this.senderName, this.senderEmail );
    }

    /**
     * Sends an Email data model via GmailApp.
     * @param {Email} email
     */
    send ( email ) {
        if ( !email || !email.to ) return;
        try {
            GmailApp.sendEmail( email.to, email.subject, 'Please view this email in a client that supports HTML.', {
                name: email.senderName,
                htmlBody: email.htmlBody
            } );
        } catch ( e ) {
            console.error( `EmailManager.send: failed to send to ${ email.to }. ${ e.message }` );
        }
    }

    // ── Private HTML builders ────────────────────────────────────────────────
    _generateHtmlTemplate_ ( receipt, paymentUrl, adjustedTotal, feeAmount ) {
        const itemRows = receipt.itemsWon.map( ( id, i ) => `
            <tr>
                <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${ id }</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee;">${ receipt.itemNames[ i ] }</td>
                <td style="padding: 8px 0; border-bottom: 1px solid #eeeeee; text-align: right;">$${ Number( receipt.itemPrices[ i ] ).toFixed( 2 ) }</td>
            </tr>
        `).join( '' );

        return `
        <html>
        <head>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;700&family=Raleway:ital,wght@0,400;1,400&family=Mr+De+Haviland&family=Source+Code+Pro:wght@400;700&display=swap" rel="stylesheet">
        </head>
        <body style="margin: 0; padding: 0; background-color: ${ this.white };">
            <div style="max-width: 600px; margin: auto; padding: 40px 20px; font-family: '${ this.ralewayFont }', sans-serif; color: ${ this.black };">
                <p>Thank you for supporting Orchard Ridge Nursery School's Auction. Your donations today will ensure that we can continue to provide high quality preschool education.</p>
                <h1 style="font-family: '${ this.interFont }', sans-serif; font-size: 18px; font-weight: bold; margin-bottom: 5px;">
                    Receipt for ${ receipt.firstName } ${ receipt.lastName }
                </h1>
                <p style="font-size: 11px; margin-top: 0; color: #444444;">Bidder #${ receipt.bidId }</p>
                <p style="font-size: 11px; line-height: 1.5; margin-top: 20px;">The following items have been purchased:</p>
                <table style="width: 100%; border-collapse: collapse; font-family: '${ this.sourceCodeProFont }', monospace; font-size: 10px; margin-top: 15px;">
                    <thead>
                        <tr style="text-align: left; font-weight: bold; color: ${ this.ornsRed };">
                            <th style="padding-bottom: 10px; border-bottom: 2px solid ${ this.ornsRed };">ID</th>
                            <th style="padding-bottom: 10px; border-bottom: 2px solid ${ this.ornsRed };">Item Name</th>
                            <th style="padding-bottom: 10px; border-bottom: 2px solid ${ this.ornsRed }; text-align: right;">Amount</th>
                        </tr>
                    </thead>
                    <tbody>${ itemRows }</tbody>
                </table>
                <div style="text-align: center; margin-top: 15px; font-family: '${ this.interFont }', sans-serif; font-size: 24px; font-weight: bold;">
                    Subtotal for cash or check: $${ receipt.totalCost.toFixed( 2 ) }
                </div>
                <div style="margin-top: 25px; padding: 15px; border: 1px solid #eee; background-color: #fafafa;">
                    <p style="margin-top: 0;">Do you still need to pay? Cash or checks are preferred, but if you wish to pay by credit card, here's the link to pay.</p>
                    <p style="text-align: center;">
                        <a href="${ paymentUrl }" style="background-color: ${ this.ornsRed }; color: ${ this.white }; padding: 10px 20px; text-decoration: none; border-radius: 5px; font-weight: bold;">
                            Pay $${ adjustedTotal } via PayPal
                        </a>
                    </p>
                    <p style="font-size: 11px; color: #666; text-align: center;">(Includes a 3.49% + $0.49 processing fee of $${ feeAmount })</p>
                </div>
                <div style="margin-top: 30px;">
                    <p>Thanks again,</p>
                    <p style="font-family: '${ this.mrDeHaviland }', cursive; font-size: 32px; margin: 0.25em 0;">Elizabeth Burke</p>
                    <p style="font-size: 10px; color: #666666;">Orchard Ridge Nursery School</p>
                    <p style="font-size: 8px; color: #666666; font-style: italic;">Orchard Ridge Nursery School is a registered 501(c)(3) nonprofit organization.<br />Federal Tax ID No: 39-1501336</p>
                </div>
                ${ this._generateFooter_() }
            </div>
        </body>
        </html>`;
    }

    _generateFooter_ () {
        return `
            <hr style="border:none; border-top:1px solid #eee; margin: 20px 0;">
            <p style="color: #666666; font-size: 11px; line-height: 1.5; text-align: center;">
              ORCHARD RIDGE NURSERY SCHOOL<br>
              1025 MCKENNA BOULEVARD, MADISON, WI | 608.274.8407
            </p>
            <p style="color: #666666; font-size: 11px; font-style: italic; line-height: 1.5; text-align: center;">
              <strong>Notice:</strong> This is an automated message from an unmonitored address. 
              Please do not reply directly to this email. For questions regarding the auction or 
              your receipt, please contact <strong>director@orns.org</strong>.
            </p>`;
    }
}