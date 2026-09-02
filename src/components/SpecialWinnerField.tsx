import { Input } from "@/components/ui/input";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Label } from "@/components/ui/label";

interface SpecialWinnerFieldProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  saving: boolean;
  disabled: boolean;
  winnerName: string;
  bordered?: boolean;
}

/**
 * One "prize -> bidder ID" entry row in the Special Winners card
 * (bidder ID input, save button, resolved winner name). Used for both
 * the gift card and 50/50 raffle prizes, which were previously
 * near-identical hand-copied blocks.
 */
export function SpecialWinnerField({
  id,
  label,
  value,
  onChange,
  onSave,
  saving,
  disabled,
  winnerName,
  bordered = false,
}: SpecialWinnerFieldProps) {
  return (
    <div className={bordered ? "space-y-3 pt-2 border-t border-slate-100" : "space-y-3"}>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={id} className="text-sm font-semibold text-slate-800">
          {label}
        </Label>
        <div className="flex gap-2">
          <Input
            id={id}
            placeholder="Bidder ID"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-32"
            disabled={disabled}
          />
          <LoadingButton
            onClick={onSave}
            loading={saving}
            className="bg-accent-blue hover:bg-accent-blue/90 text-white shrink-0 px-6"
          >
            Save
          </LoadingButton>
        </div>
        {value && (
          <p className="text-sm text-slate-600 pl-1 shrink-0">
            Winner: <span className="font-medium text-slate-900">{winnerName}</span>
          </p>
        )}
      </div>
    </div>
  );
}
