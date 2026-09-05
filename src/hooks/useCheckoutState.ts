import { Bidder, AuctionItem, Attendee } from "@/types";
import { useWinnersList } from "./useWinnersList";
import { useCheckoutReceiptActions } from "./useCheckoutReceiptActions";
import { useCheckoutBatchActions } from "./useCheckoutBatchActions";
import { useCheckoutPaymentFlow } from "./useCheckoutPaymentFlow";

export interface WinnerRecord {
  bidderId: string;
  name: string;
  total: number;
  items: { id: string; name: string; price: number }[];
  paid: boolean;
  paymentPending?: boolean;
}

interface UseCheckoutStateArgs {
  bidders: Bidder[];
  items: AuctionItem[];
  attendees: Attendee[];
  fetchAllData: () => Promise<void>;
  spreadsheetId: string;
  itemsSpreadsheetId: string;
  ticketsSpreadsheetId: string;
  bidManagementSheet: string;
  bidderNumbersSheet: string;
  folderId: string;
}

/**
 * Owns all winners-list state and mutation handlers for the checkout
 * screen: loading/parsing the winners sheet, search/tab filtering,
 * per-winner receipt actions, mark-paid flow, and the batch print/email
 * actions. Kept separate from Checkout.tsx so that component stays
 * focused on composing/rendering the split-out pieces.
 *
 * This hook itself is just composition - the real logic lives in four
 * split-out pieces (useWinnersList.ts, useCheckoutReceiptActions.ts,
 * useCheckoutBatchActions.ts, useCheckoutPaymentFlow.ts), the same
 * container-hook-split pattern already applied to every other oversized
 * file in this app (see AuctionContext.tsx). useCheckoutPaymentFlow
 * needs to read/write the winners list, so it's composed second, wired
 * to useWinnersList's `setWinners`/`specialWinners` - the same
 * one-hook's-setter-passed-into-another pattern AuctionContext.tsx uses
 * for its own child hooks.
 */
export function useCheckoutState({
  bidders,
  items,
  attendees,
  fetchAllData,
  spreadsheetId,
  itemsSpreadsheetId,
  ticketsSpreadsheetId,
  bidManagementSheet,
  bidderNumbersSheet,
  folderId,
}: UseCheckoutStateArgs) {
  const winnersList = useWinnersList({ bidders, items, fetchAllData, spreadsheetId, bidManagementSheet });
  const receiptActions = useCheckoutReceiptActions({ spreadsheetId, itemsSpreadsheetId, folderId });
  const batchActions = useCheckoutBatchActions({ spreadsheetId, itemsSpreadsheetId, folderId });
  const paymentFlow = useCheckoutPaymentFlow({
    bidders,
    attendees,
    setWinners: winnersList.setWinners,
    specialWinners: winnersList.specialWinners,
    fetchAllData,
    spreadsheetId,
    ticketsSpreadsheetId,
    bidderNumbersSheet,
  });

  return {
    winners: winnersList.winners,
    fetchingWinners: winnersList.fetchingWinners,
    processingId: receiptActions.processingId,
    searchTerm: winnersList.searchTerm,
    setSearchTerm: winnersList.setSearchTerm,
    activeTab: winnersList.activeTab,
    setActiveTab: winnersList.setActiveTab,
    pendingWinners: winnersList.pendingWinners,
    completedWinners: winnersList.completedWinners,
    pendingFilteredWinners: winnersList.pendingFilteredWinners,
    completedFilteredWinners: winnersList.completedFilteredWinners,

    handleRefresh: winnersList.handleRefresh,
    handleEmailReceipt: receiptActions.handleEmailReceipt,
    handlePrintReceipt: receiptActions.handlePrintReceipt,
    handleMarkPaid: paymentFlow.handleMarkPaid,

    isPrintingAll: batchActions.isPrintingAll,
    showPrintConfirm: batchActions.showPrintConfirm,
    setShowPrintConfirm: batchActions.setShowPrintConfirm,
    startBatchPrint: batchActions.startBatchPrint,

    isEmailingAll: batchActions.isEmailingAll,
    showEmailConfirm: batchActions.showEmailConfirm,
    setShowEmailConfirm: batchActions.setShowEmailConfirm,
    startBatchEmail: batchActions.startBatchEmail,

    showPaymentDialog: paymentFlow.showPaymentDialog,
    setShowPaymentDialog: paymentFlow.setShowPaymentDialog,
    winnerToPay: paymentFlow.winnerToPay,
    paymentMethod: paymentFlow.paymentMethod,
    setPaymentMethod: paymentFlow.setPaymentMethod,
    isSubmittingPayment: paymentFlow.isSubmittingPayment,
    confirmMarkPaid: paymentFlow.confirmMarkPaid,
  };
}
