/**
 * Utility manager. Orchestrates the interactive UI and sheet manipulation
 * required to bundle multiple auction items together.
 */
class BundlingWorkflowManager extends GlobalVariables {
    constructor ( itemManager ) {
        super();
        this.itemManager = itemManager;
        this.uiManager = new UIManager();
    }

    executeBundlingWorkflow () {
        const targetSheet = this.itemManager.auctionItems.sheet;

        const wantsBackup = this.uiManager.confirmYesNo(
            'Backup Recommended',
            'Would you like to create a backup of the "Auction-Items" tab before bundling?'
        );

        if ( wantsBackup ) {
            const timestamp = new Date().toLocaleString().replace( /[/:]/g, '-' );
            const backupName = `Auction-Items Backup (${ timestamp })`;
            targetSheet.copyTo( this.activeSpreadSheet ).setName( backupName );
            this.uiManager.showLoadingToast( `Backup created: ${ backupName }`, 'Success', 3 );
        }

        const sheetValues = targetSheet.getDataRange().getValues();
        const sessionBundles = [];
        const formatValidator = /^(\d+\s*,\s*)+\d+\s*:.+$/;
        let continueAdding = true;

        while ( continueAdding ) {
            const response = this.uiManager.promptOkCancel(
                'New Bundle Entry',
                'Enter formatting as "Row,Row: Bundle Name"\n(Example: 5,6: Gift Basket)'
            );

            if ( !response ) {
                this.uiManager.showAlert( 'Session Ended', 'Session cancelled or finished. Processing accepted bundles…' );
                break;
            }

            const trimmedResponse = response.trim();

            if ( formatValidator.test( trimmedResponse ) || trimmedResponse.includes( ':' ) ) {
                if ( !formatValidator.test( trimmedResponse ) ) {
                    const proceed = this.uiManager.confirmYesNo(
                        'Format Warning',
                        `"${ trimmedResponse }" looks slightly off from "Row,Row: Name". Attempt to process anyway?`
                    );
                    if ( !proceed ) continue;
                }
                sessionBundles.push( trimmedResponse );
            } else {
                this.uiManager.showAlert( 'Format Error', "Invalid format. Please use 'Row,Row: Name'. Remember to include the colon." );
                continue;
            }

            const addMore = this.uiManager.confirmYesNo(
                'Bundle Added',
                'Would you like to add another bundle to this session?'
            );

            if ( !addMore ) continueAdding = false;
        }

        if ( sessionBundles.length > 0 ) {
            this.processBundleSession_( targetSheet, sheetValues, sessionBundles );
        }
    }

    processBundleSession_ ( sheet, sheetValues, sessionBundles ) {
        const allRowsToDelete = new Set();
        const newItemsToCreate = [];
        const errors = [];

        sessionBundles.forEach( str => {
            const splitIndex = str.indexOf( ':' );
            const rowPart = str.substring( 0, splitIndex );
            const name = str.substring( splitIndex + 1 ).trim();
            const rowNumbers = rowPart.split( ',' ).map( r => parseInt( r.trim() ) ).filter( r => !isNaN( r ) );

            const bundleData = { name, ids: [], descriptions: [], totalValue: 0, donors: [] };
            let validBundle = true;

            rowNumbers.forEach( rowNum => {
                if ( rowNum === 1 ) {
                    errors.push( 'Row 1 is the Header Row and cannot be bundled.' );
                    validBundle = false;
                    return;
                }
                if ( rowNum < 1 || rowNum > sheetValues.length ) {
                    errors.push( `Row ${ rowNum } is outside the valid range of this sheet.` );
                    validBundle = false;
                    return;
                }

                const rowData = sheetValues[ rowNum - 1 ];
                if ( !rowData || rowData[ 0 ] === '' ) {
                    errors.push( `Row ${ rowNum } appears to be empty and was skipped.` );
                    validBundle = false;
                    return;
                }

                bundleData.ids.push( rowData[ 0 ] );
                bundleData.descriptions.push( rowData[ 4 ] );
                bundleData.totalValue += Number( rowData[ 5 ] ) || 0;
                bundleData.donors.push( rowData[ 8 ] );
                if ( validBundle ) allRowsToDelete.add( rowNum );
            } );

            if ( validBundle && rowNumbers.length > 0 ) newItemsToCreate.push( bundleData );
        } );

        if ( errors.length > 0 ) {
            this.uiManager.showAlert(
                'Invalid Entry Detected',
                'Some items could not be processed:\n\n' + errors.join( '\n' ) +
                '\n\nPlease review your row numbers and try the bundle again.'
            );
        }

        if ( newItemsToCreate.length > 0 ) {
            const startRow = sheet.getLastRow() + 1;
            const rowData = newItemsToCreate.map( item => [
                item.ids.join( ' | ' ),          // col 1: IDs
                '',                            // col 2: blank
                '',                            // col 3: checkbox added below
                item.name,                     // col 4: bundle name
                item.descriptions.join( ' | ' ), // col 5: descriptions
                item.totalValue,               // col 6: total value
                '',                            // col 7: blank
                '',                            // col 8: blank
                item.donors.join( ' | ' )        // col 9: donors
            ] );

            sheet.getRange( startRow, 1, newItemsToCreate.length, 9 ).setValues( rowData );
            sheet.getRange( startRow, 1, newItemsToCreate.length, 9 ).setBackground( '#fff2cc' );
            sheet.getRange( startRow, 3, newItemsToCreate.length, 1 ).insertCheckboxes( 'yes' ).check();
        }

        // Delete original rows in descending order to avoid index shifting
        Array.from( allRowsToDelete ).sort( ( a, b ) => b - a ).forEach( rowNum => sheet.deleteRow( rowNum ) );

        this.uiManager.showAlert( 'Complete', `Batch complete! Created ${ newItemsToCreate.length } bundles.` );
    }
}

// Global function to trigger the workflow from the menu
function requestSequentialBundles () {
    new BundlingWorkflowManager( new AuctionItemManager() ).executeBundlingWorkflow();
}