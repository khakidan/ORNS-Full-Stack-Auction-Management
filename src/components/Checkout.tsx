import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Handshake, Receipt, Mail } from "lucide-react";
import { FilterToolbar } from "@/components/FilterToolbar";
import { WinnerGrid } from "@/components/WinnerGrid";
import { PaymentMethodDialog } from "@/components/PaymentMethodDialog";
import { useCheckoutState } from "@/hooks/useCheckoutState";

export default function Checkout() {
  const { bidders, items, loading, fetchAllData, attendees } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;
  const bidManagementSheet = config.bidManagementSheet;
  const bidderNumbersSheet = config.bidderNumbersSheet;
  const folderId = config.receiptFolderId;

  const state = useCheckoutState({
    bidders,
    items,
    attendees,
    fetchAllData,
    spreadsheetId,
    ticketsSpreadsheetId,
    bidManagementSheet,
    bidderNumbersSheet,
    folderId,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-slate-50 p-4 rounded-lg border border-slate-200">
        <div className="flex flex-col sm:flex-row gap-2 w-full sm:w-auto">
          <LoadingButton
            onClick={() => state.setShowPrintConfirm(true)}
            loading={state.isPrintingAll}
            loadingText="Printing Batch..."
            icon={<Receipt className="w-4 h-4" />}
            className="bg-orns-red text-white hover:bg-orns-red/90 font-medium w-full sm:w-auto"
          >
            Print All Receipts
          </LoadingButton>
          <LoadingButton
            variant="outline"
            onClick={() => state.setShowEmailConfirm(true)}
            loading={state.isEmailingAll}
            loadingText="Sending Emails..."
            icon={<Mail className="w-4 h-4" />}
            className="w-full sm:w-auto"
          >
            Email All Winners
          </LoadingButton>
        </div>
        <div className="text-sm font-medium text-muted-foreground bg-white px-3 py-1.5 rounded border border-slate-200 shadow-sm w-full sm:w-auto text-center">
          Total Winners: <span className="text-orns-red font-bold">{state.winners.length}</span>
        </div>
      </div>

      <FilterToolbar
        className="mb-6"
        searchValue={state.searchTerm}
        onSearchChange={state.setSearchTerm}
        searchPlaceholder="Search winners..."
        trailing={
          <LoadingButton variant="outline" onClick={state.handleRefresh} loading={state.fetchingWinners} icon={<Handshake className="w-4 h-4" />}>
            Refresh Results
          </LoadingButton>
        }
      />

      <Tabs value={state.activeTab} onValueChange={(v: any) => state.setActiveTab(v)}>
        <TabsList className="grid w-full grid-cols-2 mb-6">
          <TabsTrigger value="pending">
            Pending Checkout ({state.pendingWinners.length})
          </TabsTrigger>
          <TabsTrigger value="completed">
            Already Checked Out ({state.completedWinners.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pending" className="m-0">
          <WinnerGrid
            winners={state.filteredWinners}
            loading={state.fetchingWinners}
            bidders={bidders}
            processingId={state.processingId}
            onEmailReceipt={state.handleEmailReceipt}
            onPrintReceipt={state.handlePrintReceipt}
            onMarkPaid={state.handleMarkPaid}
          />
        </TabsContent>

        <TabsContent value="completed" className="m-0">
          <WinnerGrid
            winners={state.filteredWinners}
            loading={state.fetchingWinners}
            bidders={bidders}
            processingId={state.processingId}
            onEmailReceipt={state.handleEmailReceipt}
            onPrintReceipt={state.handlePrintReceipt}
            onMarkPaid={state.handleMarkPaid}
          />
        </TabsContent>
      </Tabs>

      <ConfirmationDialog
        open={state.showPrintConfirm}
        onOpenChange={state.setShowPrintConfirm}
        title="Print All Receipts"
        description="This will generate Google Doc receipts for ALL winning bidders. These will be created in two batch documents to avoid timing out. Proceed?"
        confirmLabel="Yes, Print"
        confirmClassName="bg-orns-red text-white hover:bg-orns-red/90"
        onConfirm={state.startBatchPrint}
        isLoading={state.isPrintingAll}
      />

      <ConfirmationDialog
        open={state.showEmailConfirm}
        onOpenChange={state.setShowEmailConfirm}
        title="Email All Winners"
        description="This will email receipts to ALL winning bidders who have an email on file. Proceed?"
        confirmLabel="Yes, Email"
        onConfirm={state.startBatchEmail}
        isLoading={state.isEmailingAll}
      />

      <PaymentMethodDialog
        open={state.showPaymentDialog}
        onOpenChange={state.setShowPaymentDialog}
        winnerToPay={state.winnerToPay}
        paymentMethod={state.paymentMethod}
        onPaymentMethodChange={state.setPaymentMethod}
        isSubmitting={state.isSubmittingPayment}
        onConfirm={state.confirmMarkPaid}
      />
    </div>
  );
}
