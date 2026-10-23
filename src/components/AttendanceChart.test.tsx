/**
 * @vitest-environment jsdom
 *
 * The pie is lazy-loaded (keeps recharts off the first page load), so
 * this checks the card shows at once and the pie still arrives.
 */
import { render, screen } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { AttendanceChart } from "./AttendanceChart";

describe("AttendanceChart", () => {
  it("shows the card title at once and the pie's legend once it loads", async () => {
    render(
      <AttendanceChart
        bidderStats={[
          { name: "Checked In", value: 3, fill: "var(--chart-1)" },
          { name: "Not Present", value: 1, fill: "var(--chart-3)" },
        ]}
      />
    );

    expect(screen.getByText("Attendance Overview")).toBeTruthy();
    expect(await screen.findByText("Checked In")).toBeTruthy();
    expect(screen.getByText("Not Present")).toBeTruthy();
  });
});
