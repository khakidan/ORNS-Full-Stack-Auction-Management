/**
 * The settings the web app passed to this run (Node's Config: receipt
 * folder, logo). Set by the api* bridge functions (useRunSettings_) before
 * anything is constructed; each Apps Script execution starts with a fresh
 * global scope, so one run's settings never reach another.
 */
var RUN_SETTINGS_ = {};

/** @param {Object|null|undefined} settings e.g. { receiptFolderID, ornsLogoID } */
function useRunSettings_ ( settings ) {
    RUN_SETTINGS_ = settings && typeof settings === 'object' ? settings : {};
}

/**
 * Foundation class. Gives every subclass `this.config`: the settings the
 * web app passed to this run. The spreadsheet's `_Settings` tab is no
 * longer read - it was a second copy of the app's Config that only the
 * browser's Save Configuration kept up to date (ROADMAP B11).
 * Also holds shared string constants and UI banding colors.
 */
class GlobalVariables {
    /**
     * @param {Object} [overrides] Optional dependency/config injection, used
     *   by unit tests to avoid touching the real active spreadsheet.
     *   Production call sites (`new GlobalVariables()`, or a subclass's
     *   `super()` with no args) never pass this.
     * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} [overrides.activeSpreadSheet]
     *   Replaces `SpreadsheetApp.getActiveSpreadsheet()`.
     * @param {Object} [overrides.config]
     *   Replaces the run's settings (RUN_SETTINGS_) when given.
     */
    constructor ( overrides = {} ) {
        this.activeSpreadSheet = overrides.activeSpreadSheet || SpreadsheetApp.getActiveSpreadsheet();

        // ── Sheet name constants ─────────────────────────────────────────────
        this.bidManagementString = 'Bid-Management';
        this.bidNumbersString = 'Bidder-Numbers';

        this.config = overrides.config !== undefined ? overrides.config : RUN_SETTINGS_;

        this.currentYear = new Date().getFullYear();
    }
}
