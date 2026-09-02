# Data & Integration Schemas

This document contains the structural definitions and schemas utilized for external API integrations, Google Sheets bindings, and Firestore collections in the **ORNS Charity Auction Manager**.

---

## 1. Google Sheets Column Mapping

The application relies on Google Sheets as its primary database. The following sheets must conform to these strict column-indexed formats:

### Sheet: 'Bidder-Numbers'
This sheet tracks all event registrations, active bidders, and their checkout/payment statuses.

| Column Index | Field Name | Type | Description |
|---|---|---|---|
| Column A | `Bidder Number` | String/Number | Unique bidder ID assigned on registration |
| Column B | `First Name` | String | Guest first name |
| Column C | `Last Name` | String | Guest last name |
| Column D | `Email` | String | Email address for receipts and contact |
| Column E | `Phone` | String | Phone number |
| Column F | `Ticket Type` | String | Registration category (e.g., VIP, General) |
| Column G | `Table Number` | String | Assigned dining table |
| Column H | `Status` | String | Checked In, Checked Out, Registered, etc. |
| Column I | `Notes` | String | Admin footnotes or dietary requirements |
| **Column J** | `Invoice URL` | String | **Automated Field**: Cached URL to PayPal invoice / printable PDF receipt |
| **Column K** | `Invoice Total Amount` | Number | **Automated Field**: Calculated balance including PayPal processing fees |

---

## 2. Shared Config Schema (Cloud Firestore)

Firestore is utilized to synchronize system configuration, active operational paths, and spreadsheet links in real-time.

### Collection: `config`
*   **Document ID**: `global` (or specified deployment profiles)
*   **Fields**:
    ```json
    {
      "activeSpreadsheetId": "string (Google Sheet ID)",
      "syncStatus": "string (Idle | Syncing | Error)",
      "lastSyncedAt": "timestamp",
      "paypalSurchargePercentage": "number (e.g., 2.9)",
      "paypalFlatFee": "number (e.g., 0.30)",
      "activeAdminTabs": "array of strings"
    }
    ```

---

## 3. Transactional APIs & Surcharge Computations

All payment surcharge evaluations must be executed server-side.

*   **Endpoint**: `/api/checkout/calculate-total`
*   **Surcharge Formula**:
    $$\text{Total Paid} = \frac{\text{Subtotal} + \text{Flat Fee}}{1 - \text{Surcharge Percentage}}$$
    *Calculated via `PayPalService.calculatePayPalSurcharge` to ensure consistency between sheets logging and billing invoices.*
