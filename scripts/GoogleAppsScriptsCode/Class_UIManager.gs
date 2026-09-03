/**
 * Utility manager. Centralizes all Spreadsheet UI interactions.
 * Does NOT extend GlobalVariables — it needs no config, no sheet names,
 * and no Drive resources. Keeping it dependency-free means constructing
 * it from within other class constructors is cheap.
 */
class UIManager {
    constructor () {
        this.strings = new UIStrings();
        try {
            // This will fail when called via the API (External App)
            this.ui = SpreadsheetApp.getUi();
        } catch ( e ) {
            this.ui = null;
            console.log( "UI context not available (API execution)" );
        }
    }

    /**
     * Helper to check if we are in UI mode
     */
    hasUI () {
        return this.ui !== null;
    }

    /**
     * Shows a short toast notification while long operations run.
     * Calls getActiveSpreadsheet() directly since this class has no
     * inherited spreadsheet reference.
     */
    showLoadingToast ( message = 'This may take a minute. Please keep this spreadsheet open.',
        title = 'Processing…',
        timeout = 15 ) {
        SpreadsheetApp.getActiveSpreadsheet().toast( message, title, timeout );
    }

    /**
     * Shows a dismissable alert dialog.
     * @param {string} title
     * @param {string} message
     */
    showAlert ( title, message ) {
        this.ui.alert( title, message, this.ui.ButtonSet.OK );
    }

    /**
     * Shows a YES/NO dialog. Returns true if the user clicked YES.
     * @param {string} title
     * @param {string} message
     * @returns {boolean}
     */
    confirmYesNo ( title, message ) {
        return this.ui.alert( title, message, this.ui.ButtonSet.YES_NO ) === this.ui.Button.YES;
    }

    /**
     * Shows an OK/CANCEL alert (no text input). Returns true if the user clicked OK.
     * @param {string} title
     * @param {string} message
     * @returns {boolean}
     */
    confirmOkCancel ( title, message ) {
        return this.ui.alert( title, message, this.ui.ButtonSet.OK_CANCEL ) === this.ui.Button.OK;
    }

    /**
     * Shows a prompt dialog with an OK/CANCEL button set.
     * Returns the response text, or null if the user cancelled.
     * @param {string} title
     * @param {string} prompt
     * @returns {string|null}
     */
    promptOkCancel ( title, prompt ) {
        const response = this.ui.prompt( title, prompt, this.ui.ButtonSet.OK_CANCEL );
        return response.getSelectedButton() === this.ui.Button.OK
            ? response.getResponseText()
            : null;
    }

    /**
     * Shows a YES/NO/CANCEL dialog.
     * Returns 'YES', 'NO', or 'CANCEL' as a string.
     * @param {string} title
     * @param {string} message
     * @returns {'YES'|'NO'|'CANCEL'}
     */
    promptYesNoCancel ( title, message ) {
        const response = this.ui.alert( title, message, this.ui.ButtonSet.YES_NO_CANCEL );
        if ( response === this.ui.Button.YES ) return 'YES';
        if ( response === this.ui.Button.NO ) return 'NO';
        return 'CANCEL';
    }
}