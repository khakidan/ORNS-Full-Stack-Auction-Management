/**
 * Foundation class. Extends GlobalVariables with DocumentApp alignment
 * constants and the text style objects used by BidderLabelsDoc.
 * Nothing in this class writes to a file — it only defines constants.
 */
class GlobalStyles extends GlobalVariables {
    constructor () {
        super();

        // ── DocumentApp alignment constants ──────────────────────────────────
        this.heading1 = DocumentApp.ParagraphHeading.HEADING1;
        this.normalParagraph = DocumentApp.ParagraphHeading.NORMAL;
        this.horizontalCenter = DocumentApp.HorizontalAlignment.CENTER;
        this.verticalCenter = DocumentApp.VerticalAlignment.CENTER;

        // ── Text styles ──────────────────────────────────────────────────────
        this.bidNumNameStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: 'Montserrat',
            [ DocumentApp.Attribute.FONT_SIZE ]: 13,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 0,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 0,
            [ DocumentApp.Attribute.LINE_SPACING ]: 1,
        };

        this.bidNumStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: 'Montserrat',
            [ DocumentApp.Attribute.FONT_SIZE ]: 115,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 0,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 0,
            [ DocumentApp.Attribute.LINE_SPACING ]: 0.9,
        };
    }
}