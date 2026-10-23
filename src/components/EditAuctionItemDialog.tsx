import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FormSection } from "@/components/FormSection";
import { FormField } from "@/components/FormField";
import { AuctionItem } from "@/types";
import type { AuctionItemEditChange } from "@/hooks/useAuctionItemUpdate";

// Every field the dialog can change. The server maps each to its
// 'Auction-Items' column (itemService.ts's ITEM_FIELD_MAPPING, plus column
// M for allowMultipleWinners).
const EDITABLE_FIELDS = [
  "id",
  "category",
  "name",
  "description",
  "value",
  "openingBid",
  "minRaise",
  "donor",
  "itemType",
  "allowMultipleWinners",
] as const;

type EditableFields = Pick<AuctionItem, "id" | "category" | "name" | "description" | "value" | "openingBid" | "minRaise" | "donor" | "itemType"> & {
  allowMultipleWinners: boolean;
};

function toDraft(item: AuctionItem): EditableFields {
  return {
    id: item.id,
    category: item.category,
    name: item.name,
    description: item.description,
    value: item.value,
    openingBid: item.openingBid,
    minRaise: item.minRaise,
    donor: item.donor,
    itemType: item.itemType,
    allowMultipleWinners: !!item.allowMultipleWinners,
  };
}

interface EditAuctionItemDialogProps {
  item: AuctionItem | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  categories: string[];
  onSave: (rowIndex: number, changes: AuctionItemEditChange[]) => void | Promise<void>;
  isSaving: boolean;
}

const EMPTY_DRAFT: EditableFields = {
  id: "",
  category: "",
  name: "",
  description: "",
  value: "",
  openingBid: "",
  minRaise: "",
  donor: "",
  itemType: "",
  allowMultipleWinners: false,
};

/**
 * Replaces the 9 separate per-field EditableCell inline editors that used
 * to live in AuctionItemRow.tsx with a single dialog covering every
 * editable field at once - mirrors EditAttendeeDialog.tsx's pattern on
 * the Attendee List exactly, per the user's explicit ask. On Save, only
 * the fields that actually changed are sent on to the caller, which saves
 * them all in one request (useAuctionItemUpdate.ts's `saveItemChanges`).
 */
export function EditAuctionItemDialog({ item, open, onOpenChange, categories, onSave, isSaving }: EditAuctionItemDialogProps) {
  const [draft, setDraft] = useState<EditableFields>(EMPTY_DRAFT);

  useEffect(() => {
    if (item) setDraft(toDraft(item));
  }, [item]);

  const handleSave = () => {
    if (!item) return;

    const changes: AuctionItemEditChange[] = [];
    EDITABLE_FIELDS.forEach((field) => {
      if (field === "allowMultipleWinners") {
        if (draft.allowMultipleWinners !== !!item.allowMultipleWinners) {
          changes.push({ field, value: draft.allowMultipleWinners });
        }
        return;
      }
      if (draft[field] !== item[field]) {
        changes.push({ field, value: draft[field] });
      }
    });

    if (changes.length === 0) {
      onOpenChange(false);
      return;
    }

    onSave(item.rowIndex, changes);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit Auction Item</DialogTitle>
          <DialogDescription>Update this item's details, category, pricing, and donor.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 max-h-[65vh] overflow-y-auto pr-1">
          <FormSection title="Details">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Item #">
                {(id) => (
                  <Input id={id} value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
                )}
              </FormField>
              <FormField label="Category">
                {(id) => (
                  <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {categories.map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <FormField label="Name" className="mt-3">
              {(id) => (
                <Input id={id} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
              )}
            </FormField>
            <FormField label="Description" className="mt-3">
              {(id) => (
                <Textarea id={id} value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
              )}
            </FormField>
          </FormSection>

          <FormSection title="Pricing">
            <div className="grid grid-cols-3 gap-3">
              <FormField label="Value">
                {(id) => (
                  <Input id={id} value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
                )}
              </FormField>
              <FormField label="Opening Bid">
                {(id) => (
                  <Input id={id} value={draft.openingBid} onChange={(e) => setDraft({ ...draft, openingBid: e.target.value })} />
                )}
              </FormField>
              <FormField label="Min Raise">
                {(id) => (
                  <Input id={id} value={draft.minRaise} onChange={(e) => setDraft({ ...draft, minRaise: e.target.value })} />
                )}
              </FormField>
            </div>
          </FormSection>

          <FormSection title="Donor & Type">
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Donor">
                {(id) => (
                  <Input id={id} value={draft.donor} onChange={(e) => setDraft({ ...draft, donor: e.target.value })} />
                )}
              </FormField>
              <FormField label="Type">
                {(id) => (
                  <Select value={draft.itemType} onValueChange={(v) => setDraft({ ...draft, itemType: v })}>
                    <SelectTrigger id={id} className="w-full">
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="Physical Item">Physical Item</SelectItem>
                      <SelectItem value="Certificate">Certificate</SelectItem>
                      <SelectItem value="Both">Both</SelectItem>
                    </SelectContent>
                  </Select>
                )}
              </FormField>
            </div>
            <div className="mt-3 flex items-center gap-2">
              <Checkbox
                id="allowMultipleWinners"
                checked={draft.allowMultipleWinners}
                onCheckedChange={(checked) => setDraft({ ...draft, allowMultipleWinners: checked === true })}
              />
              <Label htmlFor="allowMultipleWinners" className="text-sm font-normal cursor-pointer">
                Allow Multiple Winners
              </Label>
            </div>
          </FormSection>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={handleSave} loading={isSaving}>Save Changes</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
