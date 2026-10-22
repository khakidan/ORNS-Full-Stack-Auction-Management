/**
 * Foundation class. Extends GlobalVariables with every DocumentApp alignment
 * constant, color, font, and text style object used by ReceiptDoc and EmailManager.
 * Nothing in this class writes to a file — it only defines constants.
 */
class GlobalStyles extends GlobalVariables {
    constructor () {
        super();

        // ── Spreadsheet UI banding colors (used by column formatters) ─────────
        this.bandingColors = [
            '#f4dcfc', '#b5e6c7', '#ffbebe', '#8edcfa', '#9cbdff',
            '#bbf2e4', '#cdbd44', '#cc94b6', '#bacb93', '#fcd1b2'
        ];

        // ── DocumentApp alignment constants ──────────────────────────────────
        this.horizontalCenter = DocumentApp.HorizontalAlignment.CENTER;
        this.horizontalLeft = DocumentApp.HorizontalAlignment.LEFT;
        this.horizontalRight = DocumentApp.HorizontalAlignment.RIGHT;
        this.heading1 = DocumentApp.ParagraphHeading.HEADING1;
        this.heading2 = DocumentApp.ParagraphHeading.HEADING2;
        this.normalParagraph = DocumentApp.ParagraphHeading.NORMAL;

        // ── Fonts ────────────────────────────────────────────────────────────
        this.ralewayFont = 'Raleway';
        this.interFont = 'Inter';
        this.playfairFont = 'Playfair Display';
        this.sourceCodeProFont = 'Source Code Pro';
        this.mrDeHaviland = 'Mr De Haviland';

        // ── Colors & spacing ─────────────────────────────────────────────────
        this.black = '#000000';
        this.white = '#ffffff';
        this.lightGray = '#cccccc';
        this.ornsRed = '#e31b23';
        this.lineSpacingLarge = 1.15;
        this.lineSpacingSmall = 0.5;
        this.lineSpacingMedium = 1;
        this.fontSizeMedium = 11;
        this.fontSizeSmall = 10;
        this.noSpacing = 0;
        this.indentSpacing = 36;

        // ── Receipt text style objects ────────────────────────────────────────
        this.receiptTitleStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.interFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 18,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingSmall,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.lineSpacingMedium,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptBodyStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.ralewayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 20,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptBodyNoTopSpacingStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.ralewayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptSmallItalicBodyStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.ralewayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 9,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.ITALIC ]: true,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptSmallQRTextStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.ralewayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 9,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        }

        this.receiptListStyleHeader = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.sourceCodeProFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing
        };

        this.receiptListStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.sourceCodeProFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptTotalDueStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.interFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 14,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingSmall,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 10,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptSignatureStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.mrDeHaviland,
            [ DocumentApp.Attribute.FONT_SIZE ]: 30,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 10,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.receiptFooterStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.ralewayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: '#666666'
        };
    }
}