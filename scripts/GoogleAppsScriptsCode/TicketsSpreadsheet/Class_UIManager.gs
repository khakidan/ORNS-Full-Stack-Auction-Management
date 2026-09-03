/**
 * Utility manager. Centralizes all Spreadsheet UI interactions so
 * Document Generators and Data Managers never call SpreadsheetApp.getUi()
 * directly.
 */
class UIManager extends GlobalVariables {
    constructor () {
        super();
        this.ui = SpreadsheetApp.getUi();
    }

    /** Shows a short toast notification while long operations run. */
    showLoadingToast ( message = 'This may take a moment. Please keep this spreadsheet open.',
        title = 'Processing…',
        timeout = 15 ) {
        this.activeSpreadSheet.toast( message, title, timeout );
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
     * Shows a YES/NO dialog and returns true if the user chose YES.
     * @param {string} title
     * @param {string} message
     * @returns {boolean}
     */
    confirmYesNo ( title, message ) {
        return this.ui.alert( title, message, this.ui.ButtonSet.YES_NO ) === this.ui.Button.YES;
    }

    /**
     * Shows a prompt dialog and returns the response text, or null if cancelled.
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
}