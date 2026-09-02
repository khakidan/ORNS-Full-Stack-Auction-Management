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
5. Submit the bid to record it against the spreadsheet.

### 3. Checking Out a Bidder
1. Go to the **Checkout** page.
2. Locate the bidder using their name or paddle number.
3. Review the items they have won.
4. If a bidder has an invalid/missing email, the **Email Receipt** button will be disabled for them.
5. Use the **Mark Paid** button once payment is received.
6. Use **Print Receipt** or **Email Receipt** to provide the bidder with transaction details.

## Troubleshooting / Quick Fixes

- **"Item #:" vs "Walk-In Ticket" Error**: If an item shows "Walk-In Ticket" instead of an ID, contact the technical administrator immediately to fix the spreadsheet row mapping.
- **Missing Email Receipt Option**: If the button is disabled, the bidder does not have a valid email address on file. Please update the bidder's information in the **Bidders** tab first.
- **Sync Issues**: If data is not appearing in the Google Sheets, verify the spreadsheet IDs in **Config Settings**.
