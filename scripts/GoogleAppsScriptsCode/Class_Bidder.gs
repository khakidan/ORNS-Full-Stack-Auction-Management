/**
 * Data model for a single bidder.
 * Pure data container — no knowledge of sheets, docs, or UI.
 */
class Bidder {
    constructor ( id, firstName, lastName, email = '', checkedIn = false, isProxy = false, checkedOut = false, paid = false, paymentMethod = '', url = '', amount = '' ) {
        this.id = id;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
        this.checkedIn = checkedIn;
        this.isProxy = isProxy;
        this.checkedOut = checkedOut;
        this.paid = paid;
        this.paymentMethod = paymentMethod;
        this.invoiceURL = url;
        this.invoicedAmount = amount;
    }

    getDisplayName () { return `${ this.firstName } ${ this.lastName }`.trim(); }

    // ── Getters ──────────────────────────────────────────────────────────────
    getId () { return this.id; }
    getFirstName () { return this.firstName; }
    getLastName () { return this.lastName; }
    getEmail () { return this.email; }
    getCheckedInStatus () { return this.checkedIn; }
    getProxyStatus () { return this.isProxy; }
    getCheckedOutStatus () { return this.checkedOut; }
    getPaidStatus () { return this.paid; }
    getPaymentMethod () { return this.paymentMethod; }
    getInvoiceURL () { return this.invoiceURL; }
    getInvoiceAmount () { return this.invoicedAmount; }

    // ── Setters ──────────────────────────────────────────────────────────────
    setId ( id ) { this.id = id; }
    setFirstName ( firstName ) { this.firstName = firstName; }
    setLastName ( lastName ) { this.lastName = lastName; }
    setEmail ( email ) { this.email = email; }
    setCheckedInStatus ( checkedIn ) { this.checkedIn = checkedIn; }
    setProxyStatus ( isProxy ) { this.isProxy = isProxy; }
    setCheckedOutStatus ( checkedOut ) { this.checkedOut = checkedOut; }
    setPaidStatus ( paid ) { this.paid = paid; }
    setPaymentMethod ( method ) { this.paymentMethod = method; }
    setInvoiceURL ( url ) { this.invoiceURL = url; }
    setInvoiceAmount ( amount ) { this.invoicedAmount = amount; }
}