import { useState } from "react";
import { useConfig } from "@/context/ConfigContext";
import { useAuction } from "@/context/AuctionContext";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Loader2, Package, Plus, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ConfirmationDialog } from "@/components/ui/ConfirmationDialog";
import { StatusStatePlaceholder } from "@/components/ui/StatusStatePlaceholder";

import { useAuctionItems } from "@/hooks/useAuctionItems";
import { useBundling } from "@/hooks/useBundling";
import { useAuctionItemsTableState } from "@/hooks/useAuctionItemsTableState";
import { BundlingDialog } from "@/components/BundlingDialog";
import { AuctionItemsFilterBar } from "@/components/AuctionItemsFilterBar";
import { AuctionItemsList } from "@/components/AuctionItemsList";
import { AuctionItemsBulkActionBar } from "@/components/AuctionItemsBulkActionBar";
import { AddAuctionItemDialog } from "@/components/AddAuctionItemDialog";
import { EditAuctionItemDialog, AuctionItemEditChange } from "@/components/EditAuctionItemDialog";
import { AuctionItem } from "@/types";

export default function AuctionItemsTab() {
  const { config } = useConfig();
  const { isAuctionClosed } = useAuction();
  const spreadsheetId = config.auctionItemsSpreadsheetId;
  const {
    items,
    setItems,
    categories,
    valueCalculations,
    loading,
    refresh: fetchData
  } = useAuctionItems(spreadsheetId);

  const table = useAuctionItemsTableState(items, setItems, spreadsheetId, valueCalculations, fetchData);

  // Single-item edit dialog state - replaces the 9 separate per-field
  // EditableCell inline editors that used to live in AuctionItemRow.tsx,
  // mirroring EditAttendeeDialog.tsx's pattern on the Attendee List. Kept
  // local here (not in useAuctionItemsTableState.ts) since it's pure UI
  // state - the actual save logic reuses table.handleUpdate unchanged.
  const [itemToEdit, setItemToEdit] = useState<AuctionItem | null>(null);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  const handleEditSave = async (rowIndex: number, changes: AuctionItemEditChange[]) => {
    setIsSavingEdit(true);
    try {
      // Category triggers a server-side resequencing + full resync
      // (see useAuctionItemUpdate.ts) - applied last so it doesn't race
      // with the other fields' own optimistic updates/background syncs
      // still in flight from the same Save.
      const nonCategoryChanges = changes.filter((c) => c.field !== "category");
      const categoryChange = changes.find((c) => c.field === "category");

      await Promise.all(
        nonCategoryChanges.map((c) => table.handleUpdate(rowIndex, c.field, c.colLetter, c.value))
      );
      if (categoryChange) {
        await table.handleUpdate(rowIndex, categoryChange.field, categoryChange.colLetter, categoryChange.value);
      }
    } finally {
      setIsSavingEdit(false);
      setItemToEdit(null);
    }
  };

  const {
    isBundling, setIsBundling,
    bundleDetails, setBundleDetails,
    aiSuggestions,
    loadingSuggestions,
    loadingDescription,
    isExecutingBundle,
    restoreBundleId,
    isExecutingRestore,
    openBundlingModal,
    getAiSuggestions,
    getAiDescriptionSuggestion,
    executeBundle,
    handleRestoreBundle
  } = useBundling(items, table.selectedRows, spreadsheetId, valueCalculations, fetchData);

  if (!spreadsheetId) {
    return (
      <Card>
        <CardContent>
          <StatusStatePlaceholder
            icon={<Package />}
            title="Not Configured"
            description="Please set the Auction Items Spreadsheet ID in Config Settings."
          />
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <div className="flex justify-center items-center p-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Auction Items Database</CardTitle>
            <CardDescription>
              Showing {table.sortedItems.length} of {items.length} items from the Auction-Items spreadsheet. Click the edit icon to make changes.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            {!isAuctionClosed && (
              <Button onClick={table.openAddItemDialog} className="flex items-center gap-2">
                <Plus className="w-4 h-4" /> Add New Item
              </Button>
            )}
            {isAuctionClosed && (
              <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 py-1.5 px-3">
                Auction Closed (Read Only)
              </Badge>
            )}
          </div>
        </CardHeader>
        <AuctionItemsFilterBar
          searchTerm={table.searchTerm}
          onSearchTermChange={table.setSearchTerm}
          selectedCategory={table.selectedCategory}
          onSelectedCategoryChange={table.setSelectedCategory}
          selectedItemType={table.selectedItemType}
          onSelectedItemTypeChange={table.setSelectedItemType}
          categories={categories}
          onReset={table.resetFilters}
          sortConfig={table.sortConfig}
          onSortConfigChange={table.setSortConfig}
        />
        <CardContent className="p-0">
          <AuctionItemsList
            items={table.sortedItems}
            selectedRows={table.selectedRows}
            selectedItemsCount={table.selectedItemsCount}
            onToggleRow={table.toggleRow}
            onToggleAll={table.toggleAll}
            onEditRequest={setItemToEdit}
            isAuctionClosed={isAuctionClosed}
            isExecutingRestore={isExecutingRestore}
            restoreBundleId={restoreBundleId}
            onRestoreBundle={handleRestoreBundle}
            onDeleteRequest={table.setItemToDelete}
          />
        </CardContent>
      </Card>

      <AuctionItemsBulkActionBar
        selectedItemsCount={table.selectedItemsCount}
        categories={categories}
        onBundle={openBundlingModal}
        onSetCategory={(val) => table.startBulkEdit("category", val)}
        onSetItemType={(val) => table.startBulkEdit("itemType", val)}
        onClear={table.clearSelection}
      />

      <ConfirmationDialog
        open={table.isBulkEditing}
        onOpenChange={table.setIsBulkEditing}
        title="Confirm Bulk Update"
        description={<>You are about to set the {table.bulkField} of {table.selectedItemsCount} items to <strong>"{table.bulkValue}"</strong>.</>}
        confirmLabel={`Apply to ${table.selectedItemsCount} Items`}
        onConfirm={table.executeBulkUpdate}
        isLoading={table.isExecutingBulk}
      />

      <BundlingDialog
        isBundling={isBundling}
        setIsBundling={setIsBundling}
        bundleDetails={bundleDetails}
        setBundleDetails={setBundleDetails}
        categories={categories}
        getAiSuggestions={getAiSuggestions}
        aiSuggestions={aiSuggestions}
        loadingSuggestions={loadingSuggestions}
        getAiDescriptionSuggestion={getAiDescriptionSuggestion}
        loadingDescription={loadingDescription}
        executeBundle={executeBundle}
        isExecutingBundle={isExecutingBundle}
      />

      <AddAuctionItemDialog
        open={table.isAddingItem}
        onOpenChange={table.setIsAddingItem}
        categories={categories}
        newItem={table.newItem}
        onNewItemChange={table.setNewItem}
        onSubmit={table.handleAddItem}
        isSubmitting={table.isSubmittingItem}
      />

      <EditAuctionItemDialog
        item={itemToEdit}
        open={!!itemToEdit}
        onOpenChange={(open) => !open && setItemToEdit(null)}
        categories={categories}
        onSave={handleEditSave}
        isSaving={isSavingEdit}
      />

      <ConfirmationDialog
        open={!!table.itemToDelete}
        onOpenChange={(open) => !open && table.setItemToDelete(null)}
        title="Confirm Deletion"
        description={<>Are you sure you want to permanently delete <strong>{table.itemToDelete?.name}</strong>? This action will remove the record from the database and cannot be undone easily.</>}
        confirmLabel="Confirm Delete"
        onConfirm={table.handleDeleteItem}
        isLoading={table.isDeleting}
        variant="destructive"
        icon={<Trash2 className="w-5 h-5" />}
      />
    </>
  );
}
