// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import Receipts from "./Receipts";
import { fetchWithRetry, getBaseUrl } from "@/services/google-api";

vi.mock("@/services/google-api", () => ({
  fetchWithRetry: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => [] }),
  getBaseUrl: vi.fn(() => "http://localhost:3000")
}));

vi.mock("@/context/ConfigContext", () => ({
  useConfig: () => ({
    config: { receiptFolderId: "mock-folder-id" }
  })
}));

const mockFiles = [
  {
    id: "file1",
    name: "Receipt_Jane_Doe",
    webViewLink: "https://drive.google.com/file1",
    iconLink: "icon.png",
    modifiedTime: new Date().toISOString()
  },
  {
    id: "file2",
    name: "Receipt_John_Smith",
    webViewLink: "https://drive.google.com/file2",
    iconLink: "icon.png",
    modifiedTime: new Date().toISOString()
  }
];

describe("Receipts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("File list renders correctly", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockFiles
    } as Response);

    render(<Receipts />);
    
    expect(await screen.findByText(/Receipt_Jane_Doe/)).toBeInTheDocument();
    expect(await screen.findByText(/Receipt_John_Smith/)).toBeInTheDocument();
  });

  it("Empty state when no files exist", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => []
    } as Response);

    render(<Receipts />);
    
    expect(await screen.findByText(/No receipts found in this folder/)).toBeInTheDocument();
  });

  it("Refresh button triggers a new fetch", async () => {
    vi.mocked(fetchWithRetry).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => []
    } as Response);

    render(<Receipts />);
    
    await screen.findByText(/No receipts found in this folder/);
    
    vi.mocked(fetchWithRetry).mockClear();

    const btn = screen.getByText("Refresh");
    await userEvent.click(btn);
    
    expect(fetchWithRetry).toHaveBeenCalledWith(
      expect.stringContaining("/api/drive/files/mock-folder-id"),
      { credentials: "include" }
    );
  });
});
