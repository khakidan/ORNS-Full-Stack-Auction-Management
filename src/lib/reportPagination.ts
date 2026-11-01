/**
 * Splits the printable close-out report's measured blocks into fixed-size
 * pages. Blocks go onto the current page while they fit, then the next.
 * - `breakBefore` starts a new page (a section that opens its own page);
 * - `keepWithNext` blocks (headings) never end a page: they move along
 *   with the block after them;
 * - a page that opens partway through a section gets a "continued" title,
 *   whose height comes off that page's room.
 * A block taller than a whole empty page still takes that page alone
 * (clipped) rather than looping forever.
 */

export interface FlowBlock {
  height: number;
  /** The section the block belongs to (its title, for the "continued" line). */
  section: string;
  /** The block is its section's heading: a page that starts with it needs no "continued" line. */
  isSectionHead?: boolean;
  keepWithNext?: boolean;
  breakBefore?: boolean;
}

export interface PaginateOptions {
  /** Room for blocks on page 1 (no running head) and on later pages. */
  firstCapacity: number;
  contCapacity: number;
  /** Height of a "continued" title. */
  continuedHeight: number;
}

export interface ReportPage {
  blocks: number[];
  /** The section this page continues, or null when it starts with a heading (or is page 1). */
  continues: string | null;
}

export function paginateReport(blocks: FlowBlock[], { firstCapacity, contCapacity, continuedHeight }: PaginateOptions): ReportPage[] {
  const pages: ReportPage[] = [{ blocks: [], continues: null }];
  const current = () => pages[pages.length - 1]!;
  const room = () => (pages.length === 1 ? firstCapacity : contCapacity) - (current().continues ? continuedHeight : 0);
  const used = (page: ReportPage) => page.blocks.reduce((t, i) => t + blocks[i]!.height, 0);
  const startPage = (first: number) => {
    pages.push({ blocks: [], continues: blocks[first]!.isSectionHead ? null : blocks[first]!.section });
  };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i]!;
    if (block.breakBefore && current().blocks.length) startPage(i);
    const page = current();
    if (page.blocks.length === 0 || used(page) + block.height <= room()) {
      page.blocks.push(i);
      continue;
    }
    // It doesn't fit. Headings at the bottom of this page go with it.
    let keep = page.blocks.length;
    while (keep > 0 && blocks[page.blocks[keep - 1]!]!.keepWithNext) keep--;
    if (keep === 0) {
      // The page is nothing but headings: moving them would only chase the block.
      page.blocks.push(i);
      continue;
    }
    const trailing = page.blocks.slice(keep);
    page.blocks = page.blocks.slice(0, keep);
    startPage(trailing[0] ?? i);
    current().blocks.push(...trailing, i);
  }
  return pages;
}
