/**
 * Foundation class. Extends GlobalVariables with every color, font, spacing
 * primitive, and DocumentApp style object used across all document generators.
 * Nothing in this class writes to a file — it only defines constants.
 */
class GlobalStyles extends GlobalVariables {
    constructor () {
        super();

        // ── Colors ───────────────────────────────────────────────────────────
        this.black = '#000000';
        this.lightGray = '#cccccc';
        this.white = '#ffffff';
        this.auctionGray = '#434343';
        this.ornsRed = '#e31b23';

        // ── Fonts ────────────────────────────────────────────────────────────
        this.courierNewFont = 'Courier New';
        this.montserratFont = 'Montserrat';
        this.playfairDisplayFont = 'Playfair Display';
        this.windsongFont = 'WindSong';

        // ── Spacing & sizing primitives ──────────────────────────────────────
        this.lineSpacingLarge = 1.15;
        this.lineSpacingMedium = 1;
        this.lineSpacingSmall = 0.5;
        this.fontSizeMedium = 12;
        this.fontSizeMediumSmall = 11;
        this.bidSheetFontSizeMedium = 11;
        this.fontSizeSmall = 10;
        this.fontSizeTiny = 9;
        this.noSpacing = 0;
        this.tenSpacing = 10;
        this.indentSpacing = 36;

        // ── DocumentApp alignment constants ──────────────────────────────────
        this.heading1 = DocumentApp.ParagraphHeading.HEADING1;
        this.heading2 = DocumentApp.ParagraphHeading.HEADING2;
        this.normalParagraph = DocumentApp.ParagraphHeading.NORMAL;
        this.horizontalCenter = DocumentApp.HorizontalAlignment.CENTER;
        this.horizontalLeft = DocumentApp.HorizontalAlignment.LEFT;
        this.horizontalRight = DocumentApp.HorizontalAlignment.RIGHT;
        this.verticalAlignCenter = DocumentApp.VerticalAlignment.CENTER;

        // ── DocumentApp text / paragraph style objects ───────────────────────
        this.auctionItemIdNumStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.courierNewFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.auctionItemStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.bidderLargeNumStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 140,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingMedium,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.bidderNameStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingMedium,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.bidderNumHeaderStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 14,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 14,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 14,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingSmall,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.biddingGuideTableHeaderStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.white
        };

        this.bidSheetDescStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 10,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.tenSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge
        };

        this.bidSheetHeaderStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge
        };

        this.bidSheetItemStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.tenSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge
        };

        this.bidSheetMinRaiseStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 8,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.bidSheetTableHeaderStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.white
        };

        this.bidSheetTableStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.black
        };

        this.blankParagraphStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingMedium,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.categoryStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 17,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingSmall,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.descriptionStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMediumSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.tenSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.donatedByStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: true,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.labelBlankParagraph = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 12,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.VERTICAL_ALIGNMENT ]: this.verticalAlignCenter,
            [ DocumentApp.Attribute.HORIZONTAL_ALIGNMENT ]: this.horizontalCenter
        };

        this.labelTableStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 13,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.VERTICAL_ALIGNMENT ]: this.verticalAlignCenter,
            [ DocumentApp.Attribute.HORIZONTAL_ALIGNMENT ]: this.horizontalCenter
        };

        this.originalValueStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.packagingDocumentStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.courierNewFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeTiny,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.receiptBodyStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 20,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.receiptBodyStyle2 = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.ITALIC ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 20,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.receiptThankYouStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 20,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.scheduleOfEventsTextStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 12,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.scheduleOfEventsTimeStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: 10,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 12,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.scheduleOfEventsTitleStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 34,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: true,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: 20,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.auctionGray
        };

        this.tableHeaderStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 18,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.FOREGROUND_COLOR ]: this.white
        };

        this.tableTentDonByBoldStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: true,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.tenSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentDonByStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: true,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.tenSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentFooterStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.playfairDisplayFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeSmall,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.tenSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingMedium,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentsDescrStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.courierNewFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.tenSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.tenSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentsItemStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 24,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentNumStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.courierNewFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: this.fontSizeMedium,
            [ DocumentApp.Attribute.BOLD ]: false,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.ITALIC ]: false,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.noSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };

        this.tableTentsValueStyle = {
            [ DocumentApp.Attribute.FONT_FAMILY ]: this.montserratFont,
            [ DocumentApp.Attribute.FONT_SIZE ]: 14,
            [ DocumentApp.Attribute.BOLD ]: true,
            [ DocumentApp.Attribute.UNDERLINE ]: false,
            [ DocumentApp.Attribute.SPACING_BEFORE ]: this.noSpacing,
            [ DocumentApp.Attribute.SPACING_AFTER ]: this.tenSpacing,
            [ DocumentApp.Attribute.LINE_SPACING ]: this.lineSpacingLarge,
            [ DocumentApp.Attribute.INDENT_START ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_END ]: this.indentSpacing,
            [ DocumentApp.Attribute.INDENT_FIRST_LINE ]: this.indentSpacing
        };
    }
}