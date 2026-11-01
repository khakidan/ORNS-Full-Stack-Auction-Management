import { describe, it, expect } from "vitest";
import { paginateReport, type FlowBlock } from "./reportPagination";

const opts = { firstCapacity: 100, contCapacity: 90, continuedHeight: 10 };
const block = (height: number, section: string, extra: Partial<FlowBlock> = {}): FlowBlock => ({ height, section, ...extra });

describe("paginateReport", () => {
  it("fills a page before starting the next", () => {
    const pages = paginateReport([block(40, "A"), block(40, "A"), block(40, "A")], opts);
    expect(pages.map((p) => p.blocks)).toEqual([[0, 1], [2]]);
  });

  it("marks a page that opens partway through a section, and takes the continued line off its room", () => {
    // Page 2 has 90 - 10 = 80: two 40s fit, a third doesn't.
    const pages = paginateReport([block(70, "A", { isSectionHead: true }), block(40, "A"), block(40, "A"), block(40, "A"), block(40, "A")], opts);
    expect(pages).toEqual([
      { blocks: [0], continues: null },
      { blocks: [1, 2], continues: "A" },
      { blocks: [3, 4], continues: "A" },
    ]);
  });

  it("starts a breakBefore section on a fresh page, with no continued line", () => {
    const pages = paginateReport([block(20, "A"), block(20, "B", { isSectionHead: true, breakBefore: true }), block(20, "B")], opts);
    expect(pages).toEqual([
      { blocks: [0], continues: null },
      { blocks: [1, 2], continues: null },
    ]);
  });

  it("moves a heading at the bottom of a page along with the block after it", () => {
    const pages = paginateReport([block(70, "A"), block(20, "B", { isSectionHead: true, keepWithNext: true }), block(40, "B")], opts);
    expect(pages).toEqual([
      { blocks: [0], continues: null },
      { blocks: [1, 2], continues: null },
    ]);
  });

  it("gives a block taller than a page a page of its own instead of looping", () => {
    const pages = paginateReport([block(30, "A"), block(500, "A"), block(30, "A")], opts);
    expect(pages.map((p) => p.blocks)).toEqual([[0], [1], [2]]);
  });
});
