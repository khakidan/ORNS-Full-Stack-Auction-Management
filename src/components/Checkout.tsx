import { useAuction } from "@/context/AuctionContext";
import { useConfig } from "@/context/ConfigContext";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { Filter, Handshake, Receipt, Mail } from "lucide-react";
import { FilterToolbar } from "@/components/FilterToolbar";
import { CheckoutStatsRow } from "@/components/CheckoutStatsRow";
import { WinnerGrid } from "@/components/WinnerGrid";
import { PaymentMethodDialog } from "@/components/PaymentMethodDialog";
import { CheckoutStatusFilter } from "@/hooks/useCheckoutState";
import { useCheckoutState } from "@/hooks/useCheckoutState";

// SelectValue with no children renders the raw stored value, not the
// matching SelectItem's label - see component-standards.md's documented
// SelectValue failure mode.
const STATUS_LABELS: Record<CheckoutStatusFilter, string> = {
  all: "All Statuses",
  awaiting: "Awaiting Checkout",
  review: "Pending Verification",
  paid: "Paid",
};

export default function Checkout() {
  const { bidders, items, loading, fetchAllData, attendees } = useAuction();
  const { config } = useConfig();
  const spreadsheetId = config.bidManagementSpreadsheetId;
  const itemsSpreadsheetId = config.auctionItemsSpreadsheetId;
  const ticketsSpreadsheetId = config.auctionTicketsSpreadsheetId;
  const bidManagementSheet = config.bidManagementSheet;
  const bidderNumbersSheet = config.bidderNumbersSheet;
  const folderId = config.receiptFolderId;
  const paypalIsSandbox = config.paypalIsSandbox;

  const state = useCheckoutState({
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
    paypalIsSandbox,
  });

  return (
    <div className="space-y-6">
      <CheckoutStatsRow
        totalWinners={state.stats.totalWinners}
        awaitingCount={state.stats.awaitingCount}
        checkedOutCount={state.stats.checkedOutCount}
        totalCollected={state.stats.totalCollected}
        totalWon={state.stats.totalWon}
      />

      <FilterToolbar
        searchValue={state.searchTerm}
        onSearchChange={state.setSearchTerm}
        searchPlaceholder="Search winners..."
        searchClassName="md:max-w-xs"
        searchInputClassName="h-10"
        filtersWrap={false}
        filters={
          <Select value={state.statusFilter} onValueChange={(v: CheckoutStatusFilter) => state.setStatusFilter(v)}>
            <SelectTrigger className="h-10 w-50 shrink-0">
              <Filter className="w-3.5 h-3.5 mr-2 opacity-70" />
              <SelectValue placeholder="Status">{(value: CheckoutStatusFilter) => STATUS_LABELS[value] ?? value}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="awaiting">Awaiting Checkout</SelectItem>
              <SelectItem value="review">Pending Verification</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        }
        trailing={
          <>
            <LoadingButton variant="outline" onClick={state.handleRefresh} loading={state.fetchingWinners} icon={<Handshake className="w-4 h-4" />}>
              Refresh
            </LoadingButton>
            <LoadingButton
              variant="outline"
              onClick={() => state.setShowPrintConfirm(true)}
              loading={state.isPrintingAll}
              loadingText="Printing Batch..."
              icon={<Receipt className="w-4 h-4" />}
            >
              Print All Receipts
            </LoadingButton>
            <LoadingButton
              onClick={() => state.setShowEmailConfirm(true)}
              loading={state.isEmailingAll}
              loadingText="Sending Emails..."
              icon={<Mail className="w-4 h-4" />}
              className="bg-orns-red text-white hover:bg-orns-red/90 font-medium"
            >
              Email All Winners
            </LoadingButton>
          </>
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
            winners={state.pendingFilteredWinners}
            loading={state.fetchingWinners}
            bidders={bidders}
            processingId={state.processingId}
            payingBidderId={state.isSubmittingPayment ? state.winnerToPay?.bidderId ?? null : null}
            onEmailReceipt={state.handleEmailReceipt}
            onPrintReceipt={state.handlePrintReceipt}
            onMarkPaid={state.handleMarkPaid}
          />
        </TabsContent>

        <TabsContent value="completed" className="m-0">
          <WinnerGrid
            winners={state.completedFilteredWinners}
            loading={state.fetchingWinners}
            bidders={bidders}
            processingId={state.processingId}
            payingBidderId={state.isSubmittingPayment ? state.winnerToPay?.bidderId ?? null : null}
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
