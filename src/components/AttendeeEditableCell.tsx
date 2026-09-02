import { useState, useEffect } from "react";
import { Loader2, Pencil, Check } from "lucide-react";
import { Input } from "@/components/ui/input";
import { IconButton } from "@/components/ui/IconButton";
import { cn } from "@/lib/utils";

interface AttendeeEditableCellProps {
  value: string;
  onSave: (newVal: string) => Promise<void>;
  placeholder?: string;
  disabled?: boolean;
}

/**
 * A lighter single-line inline editor than the shared
 * ui/EditableCell.tsx (no textarea/select variants, no Cancel button -
 * Escape reverts instead). Kept as its own local variant rather than
 * merged into the shared one for now; see refactor-opportunities.md.
 */
export function AttendeeEditableCell({ value: initialValue, onSave, placeholder = "N/A", disabled = false }: AttendeeEditableCellProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialValue);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const handleSave = async () => {
    if (value === initialValue) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleSave();
    if (e.key === "Escape") {
      setValue(initialValue);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1">
        <Input
          autoFocus
          value={value}
          onChange={e => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={saving}
          className="h-8 min-w-[100px] text-sm px-2"
        />
        <IconButton
          variant="ghost"
          aria-label="Save"
          className="h-8 w-8 text-green-600"
          icon={saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
          onClick={handleSave}
          disabled={saving}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-center gap-2">
      <div className={cn("text-base truncate", !initialValue && "text-muted-foreground italic")} title={initialValue || placeholder}>
        {initialValue || placeholder}
      </div>
      {!disabled && (
        <IconButton
          variant="ghost"
          aria-label="Edit"
          size="icon-xs"
          icon={<Pencil className="w-3.5 h-3.5" />}
          onClick={() => setEditing(true)}
          className="opacity-0 group-hover:opacity-100 text-slate-400 hover:text-slate-700 hover:bg-transparent transition-opacity"
        />
      )}
    </div>
  );
}
