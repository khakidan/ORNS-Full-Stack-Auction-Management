import { useState, useEffect, useRef } from "react";
import { toast } from "sonner";
import { errorTextFrom, getBaseUrl, postOnce } from "@/services/google-api";
import { useConfig } from "@/context/ConfigContext";
import { Config } from "@/types";
import { postJson } from "@/services/apiClient";

export function extractId(input: string): string {
  if (!input) return "";
  if (input.includes("script.google.com")) {
    const match = input.match(/\/projects\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
  }
  if (input.includes("/d/")) {
    const match = input.match(/\/d\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
  }
  if (input.includes("/folders/")) {
    const match = input.match(/\/folders\/([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
  }
  if (input.includes("id=")) {
    const match = input.match(/id=([a-zA-Z0-9-_]+)/);
    if (match) return match[1];
  }
  return input.trim();
}

async function syncSettingToCloud(spreadsheetId: string, key: string, value: string, description: string) {
  // idempotencyKey made once here, so the request's retries reuse it and
  // the server applies the change once.
  await postJson("/api/settings/update",
    { spreadsheetId, key, value, description, idempotencyKey: window.crypto.randomUUID() },
    "Failed to sync setting to cloud");
}

export function useConfigSettingsState() {
  const { config: remoteConfig, saveConfig, reloadConfig } = useConfig();
  const [config, setConfig] = useState<Config>(remoteConfig);
  // Tracks the last remoteConfig value this draft was synced from. A field
  // edit always replaces `config` with a fresh object (never mutates in
  // place - see AuctionConfigurationCard.tsx/TicketPricingCard.tsx's
  // setConfig calls), so `config !== lastSyncedRemoteConfigRef.current`
  // means the user has unsaved edits in progress. Only accept a new
  // remoteConfig (the initial async load, or a live refresh after another
  // admin saved) while the draft is still
  // clean - otherwise this would silently overwrite whatever the user is
  // mid-typing, which is the exact bug this replaced.
  const lastSyncedRemoteConfigRef = useRef<Config>(remoteConfig);

  useEffect(() => {
    setConfig((current) => {
      if (current !== lastSyncedRemoteConfigRef.current) return current;
      lastSyncedRemoteConfigRef.current = remoteConfig;
      return remoteConfig;
    });
  }, [remoteConfig]);

  const [savingSettings, setSavingSettings] = useState(false);
  const [isSettingUpNewAuction, setIsSettingUpNewAuction] = useState(false);
  const [showManualCopyDialog, setShowManualCopyDialog] = useState(false);
  const [auctionYear, setAuctionYear] = useState<number | null>(null);
  const [isAuctionConfigOpen, setIsAuctionConfigOpen] = useState(false);

  const handleSetupNewAuction = async () => {
    if (!window.confirm("Are you SURE you want to create a new auction instance? This will clear all data in the master spreadsheets!")) {
      return;
    }

    setIsSettingUpNewAuction(true);
    const toastId = toast.loading("Setting up new auction folder structure and backing up data. This may take a minute or two...", { duration: Infinity });

    try {
      const bidMgtId = extractId(config.bidManagementSpreadsheetId);
      const auctionItemsId = extractId(config.auctionItemsSpreadsheetId);
      const auctionTicketsId = extractId(config.auctionTicketsSpreadsheetId);

      // Sent once, never retried: setup makes the year's folders and clears
      // the masters, so a resend would report "already exists" though the
      // first run went through (ROADMAP A17).
      const response = await postOnce(`${getBaseUrl()}/api/auction/setup-new`, {
        ticketsSpreadsheetId: auctionTicketsId,
        itemEntrySpreadsheetId: auctionItemsId,
        bidManagementSpreadsheetId: bidMgtId
      });
      if (!response.ok) {
        const refusal = await response.json().catch(() => ({}));
        throw new Error(errorTextFrom(refusal, `Couldn't start setting up the new auction year (status ${response.status})`));
      }

      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      let data: any = null;

      if (reader) {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.trim()) {
              try {
                const msg = JSON.parse(line);
                if (msg.log) {
                  toast.loading(msg.log, { id: toastId });
                } else {
                  // If it has success or error, it's the final payload
                  data = msg;
                }
              } catch(e) {}
            }
          }
        }
      }

      if (!data) {
        throw new Error("Failed to receive valid response from server");
      }

      if (data.logs && Array.isArray(data.logs)) {
        console.group("New Auction Setup Logs");
        data.logs.forEach((logMsg: string) => console.log(logMsg));
        console.groupEnd();
      }

      if (data.success) {
        toast.dismiss(toastId);

        // The server saved the new folder IDs in the Config; load them. A
        // draft with unsaved edits isn't replaced by the reload, so give it
        // the new folders too - saving it later mustn't put last year's back.
        if (!data.configSaveError) {
          setConfig((current) => current === lastSyncedRemoteConfigRef.current
            ? current
            : { ...current, receiptFolderId: data.bidderReceiptsFolderId, forPrintFolderId: data.forPrintFolderId });
        }
        await reloadConfig();

        // Show the outcome and open dialog
        if (data.configSaveError) toast.error(data.configSaveError, { duration: Infinity });
        else toast.success(`Success! New folders created. IDs updated.`, { duration: 5000 });
        setAuctionYear(data.auctionYear);
        setShowManualCopyDialog(true);
      } else {
        toast.error(data.error || "Failed to setup new auction", { id: toastId, duration: 5000 });
      }
    } catch (error: any) {
      console.error(error);
      toast.error(error.message || "An error occurred", { id: toastId, duration: 5000 });
    } finally {
      setIsSettingUpNewAuction(false);
    }
  };

  const handleSave = async () => {
    setSavingSettings(true);

    const bidMgtId = extractId(config.bidManagementSpreadsheetId);
    const auctionItemsId = extractId(config.auctionItemsSpreadsheetId);
    const auctionTicketsId = extractId(config.auctionTicketsSpreadsheetId);

    const receiptFolderId = extractId(config.receiptFolderId);
    const forPrintFolderId = extractId(config.forPrintFolderId);
    const ornsLogoId = extractId(config.ornsLogoId);
    const auctionItemsScriptId = extractId(config.auctionItemsScriptId);
    const auctionTicketsScriptId = extractId(config.auctionTicketsScriptId);
    const bidManagementScriptId = extractId(config.bidManagementScriptId);
    const bugReportsSpreadsheetId = extractId(config.bugReportsSpreadsheetId);
    const bugReportsFolderId = extractId(config.bugReportsFolderId);

    // Save for everyone (the server's shared Config).
    let saved = true;
    try {
      await saveConfig({
        ...config,
        bidManagementSpreadsheetId: bidMgtId,
        auctionItemsSpreadsheetId: auctionItemsId,
        auctionTicketsSpreadsheetId: auctionTicketsId,
        receiptFolderId,
        forPrintFolderId,
        ornsLogoId,
        auctionItemsScriptId,
        auctionTicketsScriptId,
        bidManagementScriptId,
        bugReportsSpreadsheetId,
        bugReportsFolderId
      });
    } catch {
      // saveConfig already showed why.
      saved = false;
    }

    if (!saved) {
      setSavingSettings(false);
      return;
    }

    // Also copy to the Bid Management spreadsheet's _Settings tab, which its Apps Script reads.
    let cloudSyncFailed = false;
    if (bidMgtId) {
      try {
        await syncSettingToCloud(bidMgtId, "ticketPrice", config.ticketPrice, "Standard Walk-In Ticket Price");
        await syncSettingToCloud(bidMgtId, "receiptFolderID", receiptFolderId, "Receipts Folder ID");
        await syncSettingToCloud(bidMgtId, "forPrintFolderID", forPrintFolderId, "For Print Folder ID");
        await syncSettingToCloud(bidMgtId, "ornsLogoID", ornsLogoId, "ORNS Logo File ID");
        await syncSettingToCloud(bidMgtId, "auctionImportSheetID", auctionItemsId, "Auction Item Data Entry Spreadsheet ID");
        await syncSettingToCloud(bidMgtId, "auctionTicketSheetsID", auctionTicketsId, "Auction Tickets Spreadsheet ID");
      } catch (err: any) {
        console.error("Failed to sync settings to cloud:", err);
        cloudSyncFailed = true;
      }
    }

    setSavingSettings(false);
    if (cloudSyncFailed) {
      toast.error("Settings saved, but couldn't be copied to the Bid-Management spreadsheet's _Settings tab. Check your Bid Management Spreadsheet ID.");
    }
    setTimeout(() => window.location.reload(), 1000);
  };

  return {
    config,
    setConfig,
    savingSettings,
    isSettingUpNewAuction,
    showManualCopyDialog,
    setShowManualCopyDialog,
    auctionYear,
    isAuctionConfigOpen,
    setIsAuctionConfigOpen,
    handleSetupNewAuction,
    handleSave,
  };
}
