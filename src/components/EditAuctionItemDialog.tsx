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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AuctionItem } from "@/types";

export interface AuctionItemEditChange {
  field: keyof AuctionItem;
  colLetter: string;
  value: string;
}

// The column each editable field lives in on the 'Auction-Items' sheet -
// previously scattered across AuctionItemRow.tsx's 9 separate per-field
// EditableCell onSave calls, now centralized here since this dialog is
// the one place that needs the full map.
const FIELD_COLUMNS: Partial<Record<keyof AuctionItem, string>> = {
  id: "A",
  category: "B",
  name: "C",
  description: "D",
  value: "E",
  openingBid: "F",
  minRaise: "G",
  donor: "H",
  itemType: "I",
};

type EditableFields = Pick<AuctionItem, "id" | "category" | "name" | "description" | "value" | "openingBid" | "minRaise" | "donor" | "itemType">;

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
};

/**
 * Replaces the 9 separate per-field EditableCell inline editors that used
 * to live in AuctionItemRow.tsx with a single dialog covering every
 * editable field at once - mirrors EditAttendeeDialog.tsx's pattern on
 * the Attendee List exactly, per the user's explicit ask. On Save, only
 * the fields that actually changed are sent on to the caller (which
 * threads them through the existing useAuctionItemUpdate.ts's
 * `handleUpdate` per field - unchanged backend logic, just one form
 * instead of nine).
 */
export function EditAuctionItemDialog({ item, open, onOpenChange, categories, onSave, isSaving }: EditAuctionItemDialogProps) {
  const [draft, setDraft] = useState<EditableFields>(EMPTY_DRAFT);

  useEffect(() => {
    if (item) setDraft(toDraft(item));
  }, [item]);

  const handleSave = () => {
    if (!item) return;

    const changes: AuctionItemEditChange[] = [];
    (Object.keys(FIELD_COLUMNS) as (keyof EditableFields)[]).forEach((field) => {
      if (draft[field] !== item[field]) {
        changes.push({ field, colLetter: FIELD_COLUMNS[field]!, value: draft[field] });
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
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Details</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Item #</Label>
                <Input value={draft.id} onChange={(e) => setDraft({ ...draft, id: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Category</Label>
                <Select value={draft.category} onValueChange={(v) => setDraft({ ...draft, category: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((c) => (
                      <SelectItem key={c} value={c}>{c}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Name</Label>
              <Input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </div>
            <div className="mt-3">
              <Label className="text-xs text-muted-foreground mb-1.5 block">Description</Label>
              <Textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Pricing</div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Value</Label>
                <Input value={draft.value} onChange={(e) => setDraft({ ...draft, value: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Opening Bid</Label>
                <Input value={draft.openingBid} onChange={(e) => setDraft({ ...draft, openingBid: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Min Raise</Label>
                <Input value={draft.minRaise} onChange={(e) => setDraft({ ...draft, minRaise: e.target.value })} />
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5">Donor &amp; Type</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Donor</Label>
                <Input value={draft.donor} onChange={(e) => setDraft({ ...draft, donor: e.target.value })} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground mb-1.5 block">Type</Label>
                <Select value={draft.itemType} onValueChange={(v) => setDraft({ ...draft, itemType: v })}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Physical Item">Physical Item</SelectItem>
                    <SelectItem value="Certificate">Certificate</SelectItem>
                    <SelectItem value="Both">Both</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <LoadingButton onClick={handleSave} loading={isSaving}>Save Changes</LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
