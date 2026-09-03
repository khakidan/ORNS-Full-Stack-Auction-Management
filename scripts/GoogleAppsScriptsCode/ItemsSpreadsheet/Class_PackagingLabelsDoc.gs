/**
 * Document Generator. Copies the Avery 8163 label template (via TemplateManager)
 * and populates it with packaging labels for all auction items.
 * Items marked "Both" receive two labels (one Physical, one Certificate).
 *
 * NOTE: Unlike other generators, this class uses TemplateManager to open the
 * doc rather than creating a new one via DocService's constructor.
 */
class PackagingLabelsDoc extends DocService {
    constructor ( itemManager, folderID = null ) {
        super( null, folderID ); // null = no new doc; TemplateManager handles file placement
        this.itemManager = itemManager;

        // Pass folderID so TemplateManager places the copy in the correct folder
        const templateManager = new TemplateManager( folderID );
        this.labelDoc = templateManager.getAvery8163LabelDocCopy( 'Labels For Newly Packaged Items' );
        this.labelDocBody = this.labelDoc.getBody();

        this.labelsToPrint = [];
        this._prepareLabels();

        this.tableNum = 0;
        this.numOfSheetsNeeded = 0;

        this.labelTableTemplate = [
            [ '', '', '' ],
            [ '', '', '' ],
            [ '', '', '' ],
            [ '', '', '' ],
            [ '', '', '' ]
        ];
    }

    // ── Label-queue builder ──────────────────────────────────────────────────
    _prepareLabels () {
        const items = this.itemManager.getValidSortedItems();

        for ( const item of items ) {
            if ( item.phyOrCert === 'Physical Item' || item.phyOrCert === 'Certificate' ) {
                this.labelsToPrint.push( item );
            } else if ( item.phyOrCert === 'Both' ) {
                // Ensure duplicate items for 'Both' keeping object prototypes intact
                this.labelsToPrint.push( Object.assign( Object.create( Object.getPrototypeOf( item ) ), item, { phyOrCert: 'Physical Item' } ) );
                this.labelsToPrint.push( Object.assign( Object.create( Object.getPrototypeOf( item ) ), item, { phyOrCert: 'Certificate' } ) );
            }
        }
    }

    // ── Table-number helpers ─────────────────────────────────────────────────
    getTableNum_ () { return this.tableNum; }
    resetTableNum_ () { this.tableNum = 0; }
    incrementTableNum_ () { this.tableNum++; }

    // ── Document-structure builders ──────────────────────────────────────────
    createLabelDocument () {
        this.numOfSheetsNeeded = Math.ceil( this.labelsToPrint.length / 10 );
        for ( let count = 0; count < this.numOfSheetsNeeded; count++ ) {
            this._createTable();
        }
    }

    _createTable () {
        const tableObj = this.labelDocBody.appendTable( this.labelTableTemplate );
        tableObj.setColumnWidth( 0, 288 )
            .setColumnWidth( 1, 14.4 )
            .setColumnWidth( 2, 288 )
            .setBorderWidth( 0 );
        for ( let i = 0; i < 5; i++ ) tableObj.getRow( i ).setMinimumHeight( 141.12 );
        this.incrementTableNum_();
    }

    // ── Label-content writers ────────────────────────────────────────────────
    writeLabelDoc () {
        this.resetTableNum_();
        let row = 0;

        for ( let i = 0; i < this.labelsToPrint.length; i += 2 ) {
            if ( row >= 5 ) { row = 0; this.incrementTableNum_(); }
            const left = this.labelsToPrint[ i ];
            const right = i + 1 < this.labelsToPrint.length ? this.labelsToPrint[ i + 1 ] : null;
            this._writeItemsPerRow( left, right, row );
            row++;
        }
    }

    _writeItemsPerRow ( leftLabel, rightLabel, row ) {
        this._createIndividualLabel( leftLabel, row, 0 );
        if ( rightLabel ) this._createIndividualLabel( rightLabel, row, 2 );
    }

    _createIndividualLabel ( item, row, col ) {
        const tableCell = this.labelDocBody.getTables()[ this.getTableNum_() ].getCell( row, col );
        tableCell.insertParagraph( 0, `${ this._getItemStatus( item ) }${ this.tab4 }${ item.id }` )
            .setAttributes( this.labelTableStyle );
        tableCell.insertParagraph( 1, '' );
        tableCell.insertParagraph( 2, item.name ).setAttributes( this.labelBlankParagraph );
    }

    _getItemStatus ( item ) {
        switch ( item.phyOrCert ) {
            case 'Physical Item': return 'P';
            case 'Certificate': return 'C';
            case 'Both': return 'CP';
            default: return '';
        }
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    generateLabels () {
        this.createLabelDocument();
        this.writeLabelDoc();
        this.labelDoc.saveAndClose();
    }
}