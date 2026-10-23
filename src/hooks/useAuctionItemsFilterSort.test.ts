/**
 * @vitest-environment jsdom
 *
 * The visible-only selection (ROADMAP.md R15 moved it out of an effect
 * and into render): narrowing the view leaves hidden rows out of the
 * selection, and clearing the filter brings them back.
 */
import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useAuctionItemsFilterSort } from "./useAuctionItemsFilterSort";
import { AuctionItem } from "@/types";

function makeItem(overrides: Partial<AuctionItem> = {}): AuctionItem {
  return {
    id: "101",
    name: "Art Class",
    category: "Food",
    description: "",
    value: "",
    openingBid: "",
    minRaise: "",
    donor: "",
    itemType: "",
    status: "Active",
    bundleId: "",
    bundledDateTime: "",
    rowIndex: 2,
    ...overrides,
  };
}

const items = [
  makeItem({ id: "101", name: "Art Class", rowIndex: 2 }),
  makeItem({ id: "102", name: "Pizza Night", rowIndex: 3 }),
];

describe("useAuctionItemsFilterSort selection pruning", () => {
  it("leaves a ticked row the search hides out of the selection, and brings it back when the search clears", () => {
    const { result } = renderHook(() => useAuctionItemsFilterSort(items));

    act(() => {
      result.current.toggleRow(2);
      result.current.toggleRow(3);
    });
    expect(result.current.selectedRows).toEqual({ 2: true, 3: true });

    act(() => result.current.setSearchTerm("pizza"));
    expect(result.current.sortedItems.map(i => i.rowIndex)).toEqual([3]);
    expect(result.current.selectedRows).toEqual({ 3: true });
    expect(result.current.selectedItemsCount).toBe(1);

    act(() => result.current.resetFilters());
    expect(result.current.sortedItems).toHaveLength(2);
    expect(result.current.selectedRows).toEqual({ 2: true, 3: true });
  });

  it("leaves out a ticked row that a refresh marks Deleted", () => {
    const { result, rerender } = renderHook(({ list }) => useAuctionItemsFilterSort(list), {
      initialProps: { list: items },
    });

    act(() => result.current.toggleRow(2));
    rerender({ list: [{ ...items[0], status: "Deleted" }, items[1]] });

    expect(result.current.selectedRows).toEqual({});
    expect(result.current.selectedItemsCount).toBe(0);
  });

  it("doesn't loop when the items list is a new array on every render", () => {
    const { result } = renderHook(() => useAuctionItemsFilterSort([...items]));
    act(() => result.current.toggleRow(2));
    expect(result.current.selectedRows).toEqual({ 2: true });
  });
});
