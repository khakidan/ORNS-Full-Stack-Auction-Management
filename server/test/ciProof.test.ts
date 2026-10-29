import { it, expect } from "vitest";

// Throwaway: proves the required "test" check blocks a merge. Never merge.
it("fails on purpose", () => {
  expect(1 + 1).toBe(3);
});
