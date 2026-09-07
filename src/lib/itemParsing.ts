import { AuctionItem } from "@/types";

/**
 * Parses raw Auction-Items sheet rows (including the header row, needed
 * for column detection) into AuctionItem objects. Column positions are
 * detected by header name rather than assumed fixed, with sane
 * fallbacks if a header is missing or renamed.
 */
export function parseItemRows(values: string[][]): AuctionItem[] {
  const headers = values[0].map((h: string) => (h || "").toString().toLowerCase().trim());

  const getCol = (names: string[], defaultIdx: number) => {
    const idx = headers.findIndex((h: string) => names.some(n => h === n || h.includes(n)));
    return idx !== -1 ? idx : defaultIdx;
  };

  const idIdx = getCol(["item number", "number", "id"], 0);
  const categoryIdx = getCol(["category"], 1);
  const nameIdx = getCol(["item name", "name"], 2);
  const descIdx = getCol(["description", "desc"], 3);
  const valIdx = getCol(["value", "fair market"], 4);
  const openIdx = getCol(["opening bid", "starting bid"], 5);
  const minIdx = getCol(["min raise", "increment"], 6);
  const donorIdx = getCol(["donor", "donated"], 7);
  const typeIdx = getCol(["item type", "type", "physical", "cert"], 8);
  const statusIdx = getCol(["status"], 9);
  const bundleIdIdx = getCol(["bundle id", "bundled with"], 10);
  const bundledIdx = getCol(["bundled datetime", "bundled"], 11);
  const allowMultipleWinnersIdx = getCol(["allow multiple winners", "multiple winners"], 12);

  return values
    .slice(1)
    .map((row: string[], i: number) => ({
      id: row[idIdx]?.toString() || "",
      category: row[categoryIdx]?.toString() || "",
      name: row[nameIdx]?.toString() || "",
      description: row[descIdx]?.toString() || "",
      value: row[valIdx]?.toString() || "",
      openingBid: row[openIdx]?.toString() || "",
      minRaise: row[minIdx]?.toString() || "",
      donor: row[donorIdx]?.toString() || "",
      itemType: row[typeIdx]?.toString() || "",
      status: row[statusIdx]?.toString() || "Active",
      bundleId: row[bundleIdIdx]?.toString() || "",
      bundledDateTime: row[bundledIdx]?.toString() || "",
      // Sheets' default FORMATTED_VALUE read returns a checkbox cell as
      // the literal boolean `true`/`false` (not a "TRUE" string) - unlike
      // this app's other boolean columns (e.g. bidderParsing.ts's
      // checkedIn), which are plain-text "TRUE"/"FALSE". Checked for both
      // shapes defensively.
      allowMultipleWinners: (row[allowMultipleWinnersIdx] as unknown) === true || row[allowMultipleWinnersIdx]?.toString().toUpperCase() === "TRUE",
      rowIndex: i + 2
    }))
    .filter((item) => item.id || item.name);
}
