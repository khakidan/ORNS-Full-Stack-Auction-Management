import { describe, it, expect } from "vitest";
import { categoryBadgeClass, ITEM_TYPE_STYLES } from "./itemBadgeColors";

describe("categoryBadgeClass", () => {
  it("is stable for the same category across repeated calls", () => {
    const first = categoryBadgeClass("Food");
    const second = categoryBadgeClass("Food");
    expect(second).toBe(first);
  });

  it("hashes real category names to the expected palette entries", () => {
    // Exact values pinned so a change to the hash or palette shows up as
    // a real, deliberate diff rather than a silent drift - both ItemRow.tsx
    // and AuctionItemRow.tsx must agree on these for the same category.
    expect(categoryBadgeClass("Food")).toBe("bg-amber-50 text-amber-700 border-amber-200");
    expect(categoryBadgeClass("Home & Garden")).toBe("bg-indigo-50 text-indigo-700 border-indigo-200");
    expect(categoryBadgeClass("Health & Beauty")).toBe("bg-blue-50 text-blue-700 border-blue-200");
    expect(categoryBadgeClass("Travel")).toBe("bg-cyan-50 text-cyan-700 border-cyan-200");
  });

  it("routes different category names to different palette entries, not one bucket for everything", () => {
    const classes = new Set(
      ["Food", "Home & Garden", "Health & Beauty", "Travel", "Electronics", "Wine & Spirits"].map(categoryBadgeClass)
    );
    expect(classes.size).toBeGreaterThan(1);
  });

  it("handles an empty category string without throwing", () => {
    expect(() => categoryBadgeClass("")).not.toThrow();
  });
});

describe("ITEM_TYPE_STYLES", () => {
  it("has exactly the 3 item types AuctionItemsFilterControls.tsx's <select> offers", () => {
    expect(Object.keys(ITEM_TYPE_STYLES).sort()).toEqual(["Both", "Certificate", "Physical Item"]);
  });

  it("gives each item type a distinct class, none overlapping with the others or the Bundle badge's purple", () => {
    const classes = Object.values(ITEM_TYPE_STYLES).map((s) => s.className);
    expect(new Set(classes).size).toBe(classes.length);
    classes.forEach((c) => expect(c).not.toContain("purple"));
  });

  it("gives each item type a distinct icon", () => {
    const icons = Object.values(ITEM_TYPE_STYLES).map((s) => s.icon);
    expect(new Set(icons).size).toBe(icons.length);
  });
});
