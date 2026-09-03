/**
 * Data model for a single outgoing email.
 * Pure data container — holds everything GmailApp.sendEmail needs.
 * Built by EmailManager; consumed by EmailManager.send().
 */
class Email {
    /**
     * @param {string} to
     * @param {string} subject
     * @param {string} htmlBody
     * @param {string} senderName
     * @param {string} senderEmail
     */
    constructor ( to, subject, htmlBody, senderName, senderEmail ) {
        this.to = to;
        this.subject = subject;
        this.htmlBody = htmlBody;
        this.senderName = senderName;
        this.senderEmail = senderEmail;
    }
}