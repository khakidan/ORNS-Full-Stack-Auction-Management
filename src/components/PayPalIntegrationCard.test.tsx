/**
 * @vitest-environment jsdom
 */
import React from "react";
import "@testing-library/jest-dom";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import PayPalIntegrationCard from "./PayPalIntegrationCard";
import { Config } from "@/types";

const BASE_CONFIG: Config = {
  auctionItemsSpreadsheetId: "items-id",
  auctionTicketsSpreadsheetId: "tickets-id",
  bidManagementSpreadsheetId: "bm-id",
  bidderNumbersSheet: "Bidder-Numbers",
  bidManagementSheet: "Bid-Management",
  receiptFolderId: "receipt-folder",
  forPrintFolderId: "print-folder",
  ornsLogoId: "logo-id",
  ticketPrice: "35",
  ticketPriceFromWebsiteAt: "",
  auctionItemsScriptId: "items-script",
  auctionTicketsScriptId: "tickets-script",
  bidManagementScriptId: "bm-script",
  bugReportsSpreadsheetId: "bug-reports-id",
  bugReportsFolderId: "bug-reports-folder",
  paypalIsSandbox: true,
};

describe("PayPalIntegrationCard", () => {
  it("shows the Sandbox badge and checked checkbox, with no production warning, when paypalIsSandbox is true", () => {
    render(<PayPalIntegrationCard config={BASE_CONFIG} setConfig={vi.fn()} />);

    expect(screen.getByText("Sandbox")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /sandbox mode/i })).toHaveAttribute("aria-checked", "true");
    expect(screen.queryByText(/production mode is on/i)).not.toBeInTheDocument();
  });

  it("shows the Production badge and the real-invoice warning when paypalIsSandbox is false", () => {
    render(<PayPalIntegrationCard config={{ ...BASE_CONFIG, paypalIsSandbox: false }} setConfig={vi.fn()} />);

    expect(screen.getByText("Production")).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /sandbox mode/i })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(/production mode is on/i)).toBeInTheDocument();
  });

  it("unchecking the checkbox flips paypalIsSandbox to false", () => {
    const setConfig = vi.fn();
    render(<PayPalIntegrationCard config={BASE_CONFIG} setConfig={setConfig} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /sandbox mode/i }));

    expect(setConfig).toHaveBeenCalledWith({ ...BASE_CONFIG, paypalIsSandbox: false });
  });

  it("checking the checkbox flips paypalIsSandbox back to true", () => {
    const setConfig = vi.fn();
    const productionConfig = { ...BASE_CONFIG, paypalIsSandbox: false };
    render(<PayPalIntegrationCard config={productionConfig} setConfig={setConfig} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /sandbox mode/i }));

    expect(setConfig).toHaveBeenCalledWith({ ...productionConfig, paypalIsSandbox: true });
  });

  it("links to the PayPal sandbox dashboard when in sandbox mode", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PayPalIntegrationCard config={BASE_CONFIG} setConfig={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open paypal sandbox dashboard/i }));

    expect(openSpy).toHaveBeenCalledWith("https://developer.paypal.com/dashboard/accounts", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });

  it("links to the PayPal live business dashboard when in production mode", () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    render(<PayPalIntegrationCard config={{ ...BASE_CONFIG, paypalIsSandbox: false }} setConfig={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: /open paypal business dashboard/i }));

    expect(openSpy).toHaveBeenCalledWith("https://www.paypal.com/businessexp/summary", "_blank", "noopener,noreferrer");
    openSpy.mockRestore();
  });
});
