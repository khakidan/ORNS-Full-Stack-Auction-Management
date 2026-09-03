function onOpen () {
    const ui = SpreadsheetApp.getUi();
    ui.createMenu( 'Auction Documents' )
        .addItem( 'Generate Bidder Labels', 'generateBidderLabels' )
        .addItem( 'Set File & Folder Locations', 'updateFileOrFolderLocations' )
        .addToUi();
}