import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { GuestSlotIndex } from "@/lib/attendeeSheetColumns";

export interface GuestDraft {
  guestIndex: GuestSlotIndex;
  name: string;
  firstName: string;
  lastName: string;
  email: string;
  ownBidderNumber: string;
}

export const MAX_GUESTS = 3;

export function makeGuestDraft(guestIndex: GuestSlotIndex): GuestDraft {
  return { guestIndex, name: "", firstName: "", lastName: "", email: "", ownBidderNumber: "" };
}

interface AttendeeGuestsEditorProps {
  guests: GuestDraft[];
  onChange: (guests: GuestDraft[]) => void;
  /** false on the staff/sponsor sheets - no sheet column exists for this there. */
  allowOwnBidderNumber: boolean;
}

/**
 * Shared guest editor for the Add and Edit Attendee dialogs - see the
 * "Attendee Tickets workflow challenges" bug report ("no way to add
 * guests to their account", "no way to indicate...that the bidder
 * wishes to have guests"). Up to 3 guest slots per attendee, matching
 * the ticket sheet's fixed 3-guest-column layout
 * (attendeeSheetColumns.ts) - per explicit user confirmation, more than
 * 3 would require adding new sheet columns first, out of scope here.
 */
export function AttendeeGuestsEditor({ guests, onChange, allowOwnBidderNumber }: AttendeeGuestsEditorProps) {
  const usedSlots = new Set(guests.map((g) => g.guestIndex));
  const nextSlot = ([1, 2, 3] as const).find((n) => !usedSlots.has(n));

  const updateGuest = (guestIndex: GuestSlotIndex, field: "firstName" | "lastName" | "email" | "ownBidderNumber", value: string) => {
    onChange(
      guests.map((g) => {
        if (g.guestIndex !== guestIndex) return g;
        const updated = { ...g, [field]: value };
        if (field === "firstName" || field === "lastName") {
          updated.name = `${updated.firstName} ${updated.lastName}`.trim();
        }
        return updated;
      })
    );
  };

  const addGuest = () => {
    if (!nextSlot) return;
    onChange([...guests, makeGuestDraft(nextSlot)].sort((a, b) => a.guestIndex - b.guestIndex));
  };

  const removeGuest = (guestIndex: GuestSlotIndex) => {
    onChange(guests.filter((g) => g.guestIndex !== guestIndex));
  };

  return (
    <div className="flex flex-col gap-2">
      {guests.map((g) => (
        <div key={g.guestIndex} className="border rounded-lg p-3 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-muted-foreground">Guest {g.guestIndex}</span>
            <IconButton
              variant="ghost"
              aria-label={`Remove guest ${g.guestIndex}`}
              icon={<X className="w-3.5 h-3.5" />}
              size="icon-sm"
              className="h-6 w-6 text-muted-foreground hover:text-destructive"
              onClick={() => removeGuest(g.guestIndex)}
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Input aria-label={`Guest ${g.guestIndex} first name`} placeholder="First" value={g.firstName} onChange={(e) => updateGuest(g.guestIndex, "firstName", e.target.value)} />
            <Input aria-label={`Guest ${g.guestIndex} last name`} placeholder="Last" value={g.lastName} onChange={(e) => updateGuest(g.guestIndex, "lastName", e.target.value)} />
          </div>
          <Input aria-label={`Guest ${g.guestIndex} email`} placeholder="Guest email" value={g.email} onChange={(e) => updateGuest(g.guestIndex, "email", e.target.value)} />
          {allowOwnBidderNumber && (
            <div className="flex items-center gap-2 pt-0.5">
              <Checkbox
                id={`guest-${g.guestIndex}-own-bidder`}
                checked={g.ownBidderNumber?.toLowerCase() === "yes"}
                onCheckedChange={(checked) => updateGuest(g.guestIndex, "ownBidderNumber", checked === true ? "yes" : "no")}
              />
              <Label htmlFor={`guest-${g.guestIndex}-own-bidder`} className="text-xs font-normal cursor-pointer">
                Wants their own bidder number
              </Label>
            </div>
          )}
        </div>
      ))}

      {guests.length === 0 && (
        <span className="text-sm text-muted-foreground italic">No guests on this entry.</span>
      )}

      {nextSlot && (
        <Button type="button" variant="outline" size="sm" className="gap-1.5 w-fit" onClick={addGuest}>
          <Plus className="w-3.5 h-3.5" /> Add Guest
        </Button>
      )}
    </div>
  );
}
