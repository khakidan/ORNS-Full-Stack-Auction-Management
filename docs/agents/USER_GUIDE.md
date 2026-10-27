# Auction Management App: User Guide

## App Overview
This application is designed to streamline the operation of live and online charity auctions. It provides tools for managing auction items, registered bidders, bid entry, payment processing, and receipt generation.

## Core Features & Capabilities

### Auction Manager
- **Config Settings**: Manage global settings such as standard Walk-In ticket prices and integration with Google Sheets.
- **Auction Items**: Sync and manage the master auction catalog, including item types (physical, certificate) and details.

### Auction Staff (Clerks & Ringmen)
- **Bid Entry**: Quickly record winning bids for specific items against paddle numbers.
- **Bidders**: Manage participant information and assign/track paddle numbers.

### Checkout & Cashier
- **Bid Management**: Monitor active auctions, track bid statuses, and facilitate payments (via PayPal integration).
- **Checkout**: Finalize transactions for bidders, including marking items as paid, printing/emailing receipts to buyers.

## Step-by-Step Operational Workflows

### 1. Registering a Walk-In Bidder
1. Navigate to the **Bidders** page.
2. Select **New Walk-In Ticket**.
3. Enter participant information.
4. The system will automatically assign an ID and apply correct pricing based on current configurations.

### 2. Processing a Bid
1. Access the **Bid Entry** screen.
2. Identify the **Item #** being sold.
3. Enter the **Paddle Number** of the winning bidder.
4. Enter the final **Price**.
5. Compare the large summary (item #, bidder #, amount, with the item and bidder names) with the bid sheet.
6. Submit the bid to record it against the spreadsheet.

The app asks **Check the bid sheet** before recording an amount that looks mistyped: below the item's opening bid, above the opening bid by less than the minimum raise, or more than 3 times the item's value. Choose **Fix it** to correct the amount, or **Record anyway** if the sheet really says that. In Batch Entry, such a row is marked "to check" and isn't recorded until you click **Looks right** on it.

### 3. Checking Out a Bidder
1. Go to the **Checkout** page.
2. Locate the bidder using their name or paddle number.
3. Review the items they have won.
4. If a bidder has an invalid/missing email, the **Email Receipt** button will be disabled for them.
5. Use the **Mark Paid** button once payment is received.
   - **Cash or check:** the app takes the card processing fee off the bidder's PayPal invoice and records the payment, so PayPal shows it paid in full with nothing left owing. If a yellow warning appears instead, follow what it says (usually: mark the invoice paid in the PayPal dashboard).
6. Use **Print Receipt** or **Email Receipt** to provide the bidder with transaction details.
7. **Print All Receipts** prints 25 bidders per file, in alphabetical order, and shows "part 2 of 4" as it goes. The files are named like "Receipts - Part 2 of 4 (Garcia - Lopez)". Use it after bidding has closed.
   - If it stops partway, the message says which parts were printed. Those files are already in the Receipts folder.

## Troubleshooting / Quick Fixes

- **"Item #:" vs "Walk-In Ticket" Error**: If an item shows "Walk-In Ticket" instead of an ID, contact the technical administrator immediately to fix the spreadsheet row mapping.
- **Missing Email Receipt Option**: If the button is disabled, the bidder does not have a valid email address on file. Please update the bidder's information in the **Bidders** tab first.
- **PayPal invoices for bidders with no email**: these go to **web-admin@orns.org** (still in the bidder's name), so staff have the payment link if the bidder needs it.
- **"No answer from the server" when creating a document or receipt**: the document may still have been made. Check the folder before clicking again, so you don't get two copies.
- **"Already being created" / "already printing"**: someone (or an earlier click) started the same document and it hasn't finished. Wait for it, then check the folder.
- **Documents, labels or receipts suddenly failing**: on the **Config Settings** page, click **Check Script Versions**. Any script marked "Out of date" or "Couldn't check" needs the technical administrator.
- **Sync Issues**: If data is not appearing in the Google Sheets, verify the spreadsheet IDs in **Config Settings**.
- **Connection banner**: A banner at the top of the page appears when Google Sheets is slow or the internet connection drops.
  - **Winning bids aren't lost.** A bid that can't be sent is marked **Saved on this device** in Bid Entry, and sends on its own once the connection is back. Keep entering bids, and keep that tab open. Closing it with bids waiting shows a "Leave site?" warning; the bids stay saved on that device and send the next time the app is opened there.
  - **Only winning bids are saved for later.** Checkout, receipts and emails need a working connection. If the banner says you're offline, wait before using them.
  - **"Couldn't be recorded"**: a saved bid the server refused when it was resent, usually because another device recorded a winner for the same item meanwhile. Click **Review** to see why, then **Try again** or **Remove** it (removing only clears the list; re-enter the bid if it should still count).
  - **"Your sign-in has expired"**: click **Sign in again**; the saved bids send afterwards.
