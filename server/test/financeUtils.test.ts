import { describe, it, expect } from "vitest";
import { calculatePayPalSurcharge } from "../utils/financeUtils";

describe("financeUtils - calculatePayPalSurcharge", () => {
  it("keeps penny math exact on normal payments", () => {
    // Standard bid amount: $100.
    // Total Invoice = (100 + 0.49) / (1 - 0.0349) = 100.49 / 0.9651 = 104.1239...
    // Rounded total = $104.12
    // Surcharge = 104.12 - 100 = $4.12
    const result = calculatePayPalSurcharge(100);
    expect(result.total).toBe(104.12);
    expect(result.surcharge).toBe(4.12);
  });

  it("handles high bid volumes and values accurately", () => {
    // High bid amount: $10,000.
    // Total Invoice = (10000 + 0.49) / 0.9651 = 10000.49 / 0.9651 = 10362.128...
    // Rounded total = $10362.13
    // Surcharge = 10362.13 - 10000 = $362.13
    const result = calculatePayPalSurcharge(10000);
    expect(result.total).toBe(10362.13);
    expect(result.surcharge).toBe(362.13);
  });

  it("handles low/zero boundaries cleanly without negative drifts", () => {
    const result = calculatePayPalSurcharge(0);
    // Total Invoice = (0 + 0.49) / 0.9651 = 0.49 / 0.9651 = 0.5077...
    // Rounded total = $0.51
    // Surcharge = 0.51 - 0 = $0.51
    expect(result.total).toBe(0.51);
    expect(result.surcharge).toBe(0.51);
  });

  it("calculates accurate surcharge on single digit amounts", () => {
    const result = calculatePayPalSurcharge(5);
    // Total Invoice = (5 + 0.49) / 0.9651 = 5.49 / 0.9651 = 5.68853...
    // Rounded total = 5.69
    expect(result.total).toBe(5.69);
    expect(result.surcharge).toBe(0.69);
  });

  it("throws instead of silently returning a nonsensical negative invoice total for a negative bid amount", () => {
    // Without this guard, calculatePayPalSurcharge(-1) used to return
    // { total: -0.53, surcharge: 0.47 } - a negative dollar amount to
    // invoice someone for, which would have been baked straight into a
    // real receipt/invoice email (server/services/emailService.ts's
    // processEmail, the only caller). A negative bid total only happens
    // from corrupted/malformed sheet data (a bad price cell), so this is
    // meant to fail loudly rather than silently send a bogus amount.
    expect(() => calculatePayPalSurcharge(-1)).toThrow(/must not be negative/);
    expect(() => calculatePayPalSurcharge(-0.01)).toThrow(/must not be negative/);
  });
});
