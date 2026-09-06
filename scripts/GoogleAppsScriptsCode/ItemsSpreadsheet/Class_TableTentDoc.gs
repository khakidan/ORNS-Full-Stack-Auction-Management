/**
 * Document Generator. Produces table-tent cards for display at auction tables,
 * skipping Live and Movie Night items.
 *
 * @param {string}             fileName
 * @param {AuctionItem[]} items  Already-resolved, valid/sorted items.
 */
class TableTentDoc extends DocService {
    constructor ( fileName, items, folderID = null ) {
        super( fileName, folderID );
        this.items = items;

        this.donatedByHeaderText = 'Donated By:';
        this.disclaimerTextLine1 = '• For Display Purposes Only •';
        this.disclaimerTextLine2 = 'Winning bidder can claim gift certificate(s) at check out.';
    }

    // ── Item-write helper ────────────────────────────────────────────────────
    writeTableTentItem_ ( item ) {
        const disclaimer = this.disclaimerTextLine1 + this.hardReturn
            + this.disclaimerTextLine2 + this.hardReturn2;

        this.writeTextWithStyle_( item.id, this.normalParagraph, this.horizontalCenter, this.tableTentNumStyle );
        this.writeTextWithStyle_( item.name, this.heading1, this.horizontalCenter, this.tableTentsItemStyle );
        this.writeTextWithStyle_( `Value: $${ item.value }`, this.heading2, this.horizontalCenter, this.tableTentsValueStyle );
        this.writeTextWithStyle_( item.description, this.normalParagraph, this.horizontalLeft, this.tableTentsDescrStyle );
        this.writeMultiLineTextWithStyle_(
            this.donatedByHeaderText + this.hardReturn,
            item.donatedBy,
            this.normalParagraph,
            this.horizontalRight,
            this.tableTentDonByBoldStyle,
            this.tableTentDonByStyle
        );
        this.writeTextWithStyle_( disclaimer, this.normalParagraph, this.horizontalCenter, this.tableTentFooterStyle );
    }

    // ── Loop ─────────────────────────────────────────────────────────────────
    loopThroughAllAuctionItemsForTableTents_ () {
        const items = this.items;

        for ( const item of items ) {
            if ( item.category === 'Live' || item.category === 'Movie Night' ) continue;
            this.writeTableTentItem_( item );
        }
    }

    // ── Public orchestrator ──────────────────────────────────────────────────
    generateTableTents () {
        this.loopThroughAllAuctionItemsForTableTents_();
        this.doc.saveAndClose();
    }
}
