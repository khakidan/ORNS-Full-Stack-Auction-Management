/**
 * Foundation class. Stores all UI dialog text, prompts, and alert messages.
 * Centralizes text management so changes can be made in one place.
 *
 * Instantiated once, inside UIManager, as this.strings.
 * Access from any class via: this.uiManager.strings.*
 */
class UIStrings {
    constructor () {

        // ── Generic / Reused ─────────────────────────────────────────────────
        this.successTitle = 'Success';
        this.errorTitle = 'Error';
        this.invalidInputTitle = 'Invalid Input';
        this.systemErrorTitle = 'System Error';
        this.continueTitle = 'Continue?';

        // ── SettingsManager ───────────────────────────────────────────────────
        this.settingsWorkflowTitle = 'Which setting are you updating?';
        this.settingsWorkflowPrompt = '\n\nEnter the number (e.g., 1):';
        this.invalidSelectionTitle = 'Invalid Selection';
        this.invalidSelectionMsg = ( text, max ) => `"${ text }" is not a valid option. Please enter a number between 1 and ${ max }.`;

        this.ticketPriceTitle = 'Update Ticket Price';
        this.ticketPricePrompt = ( current ) => `Current Walk-In Price: $${ current }\n\nEnter new price (numbers only):`;
        this.invalidPriceTitle = 'Invalid Price';
        this.invalidPriceMsg = 'Please enter a valid number (e.g., 35 or 40.00).';
        this.ticketPriceSuccessMsg = ( price ) => `Ticket price updated to $${ price }.`;

        this.updateDriveTitle = ( label ) => `Updating: ${ label }`;
        this.updateDrivePrompt = 'Paste the Google Drive URL:';
        this.invalidDriveUrlTitle = 'Invalid URL';
        this.invalidDriveUrlMsg = 'No Google Drive ID was found in that URL. Please paste the full URL from your browser address bar.';
        this.locationDescTitle = 'Location Description';
        this.locationDescPrompt = "Where is this located? (e.g., 2027 Auction > Dan's Folder):";
        this.settingUpdateSuccessMsg = 'Setting updated successfully.';

        // ── BidderManager ─────────────────────────────────────────────────────
        this.setupCancelledTitle = 'Setup Cancelled';
        this.setupCancelledMsg = 'The Bidder-Numbers sheet already contains data. Clear it if you want to run a fresh setup.';

        // ── AuctionSetupManager ───────────────────────────────────────────────
        this.bidMgmtAlreadySetupTitle = 'Setup Cancelled';
        this.bidMgmtAlreadySetupMsg = "The 'Bid-Management' sheet already appears to be set up. Clear or delete it to run a fresh setup.";
        this.setupErrorTitle = 'Setup Error';
        this.noBiddersFoundMsg = "No bidders found. Please run 'Setup Bidder Numbers' first.";

        // ── CheckInManager ────────────────────────────────────────────────────
        this.checkInTitle = 'Check-In';
        this.checkInLastNamePrompt = "Enter the bidder's last name:";
        this.blankLastNameMsg = 'Last name cannot be blank. Please try again.';
        this.multipleMatchesTitle = 'Multiple Matches Found';
        this.multipleMatchesPrompt = ( count ) => `${ count } people share that last name. Enter first name to narrow down:`;
        this.blankFirstNameMsg = 'First name cannot be blank. Please try again.';
        this.noMatchTitle = 'No Match';
        this.noFirstNameMatchMsg = ( name ) => `No bidder found with first name "${ name }". Try a different first name?`;
        this.alreadyCheckedInTitle = 'Already Checked In';
        this.alreadyCheckedInMsg = ( first, last ) => `${ first } ${ last } is already marked as present.`;
        this.checkInCompleteTitle = 'Check-In Complete';
        this.checkInCompleteMsg = ( first, last ) => `${ first } ${ last } is now checked in.`;
        this.bidderNotFoundTitle = 'Bidder Not Found';
        this.bidderNotFoundWalkInMsg = 'No bidder found with that name. Would you like to sell them a walk-in ticket?';

        // ── CheckInManager — Walk-In Ticket ───────────────────────────────────
        this.newTicketTitle = 'New Ticket';
        this.newTicketFirstNamePrompt = 'Enter first name:';
        this.newTicketEmailPrompt = 'Enter email address (leave blank if not provided):';
        this.walkInCreatedTitle = 'Walk-In Ticket Created';
        this.walkInCreatedMsg = ( id, first, last, email ) =>
            `Created Bidder ${ id } — ${ first } ${ last }` + ( email ? ` (${ email })` : ' (no email provided)' ) + '.';

        // ── BidEntryManager ───────────────────────────────────────────────────
        this.dataEntryTitle = 'Data Entry';
        this.itemNumberPrompt = 'Item Number:';
        this.blankItemMsg = 'Item number cannot be blank. Please try again.';
        this.itemNotFoundTitle = 'Item Not Found';
        this.itemNotFoundMsg = ( id ) => `Item #${ id } does not exist in the Auction-Items list. Please verify the number.`;
        this.bidderIdPrompt = 'Bidder ID:';
        this.blankBidderIdMsg = 'Bidder ID cannot be blank. Please try again.';
        this.bidderNotFoundInBidMgmtMsg = ( id ) => `Bidder ${ id } was not found in the Bid-Management sheet. Please try again.`;
        this.bidderNotCheckedInTitle = 'Bidder Not Checked In';
        this.bidderNotCheckedInMsg = ( id ) => `Bidder ${ id } is not checked in and is not a proxy bidder. Please check them in before recording a winning bid.`;
        this.winningBidPrompt = 'Winning Bid ($):';
        this.invalidBidPriceMsg = 'Please enter a valid numeric amount (e.g., 150 or 75.50).';
        this.enterAnotherBidMsg = 'Enter another bid?';
        this.bidMgmtNotFoundMsg = "'Bid-Management' sheet not found.";
        this.auctionTotalTitle = 'Auction Total';
        this.totalRaisedMsg = ( amount ) => `Total Funds Raised: ${ amount }`;

        // ── CheckOutManager ───────────────────────────────────────────────────
        this.checkOutTitle = 'Check-Out';
        this.checkOutBidderIdPrompt = 'Enter Bidder ID:';
        this.bidderNotFoundRetryMsg = ( id ) => `Bidder ID "${ id }" was not found in the system. Would you like to try a different ID?`;
        this.notCheckedInTitle = 'Not Checked In';
        this.notCheckedInMsg = ( id ) => `Bidder ${ id } was never checked in. Please run Check-In for this bidder before attempting to check them out.`;
        this.alreadyCheckedOutTitle = 'Already Checked Out';
        this.alreadyCheckedOutMsg = ( id ) => `Bidder ${ id } has already completed check-out.`;
        this.liveAuctionWinnerQuestion = 'Did this bidder win any Live Auction items?';
        this.liveItemsEnteredQuestion = 'Are all of their live auction items entered in the system?';
        this.holdOnTitle = 'Hold On';
        this.waitForItemsMsg = 'Please wait until all live auction items are entered in the system before checking this bidder out.';
        this.paymentTitle = 'Payment';
        this.alreadyPaidQuestion = 'Has the bidder already paid?';
        this.checkOutSuccessMsg = 'Check-out and payment recorded.';
        this.collectPaymentTitle = 'Collect Payment';
        this.collectPaymentMsg = 'Collect payment from the bidder now (cash or check preferred), then click OK to mark them as paid.';
        this.checkOutCancelledTitle = 'Check-Out Cancelled';
        this.checkOutCancelledMsg = 'The bidder has not been checked out. Please re-run check-out when ready.';
        this.receiptReadyTitle = 'Receipt Ready';
        this.receiptReadyMsg = ( total ) => `Total due: ${ total }. The receipt has been saved to the folder. Please print it now.`;
    }
}