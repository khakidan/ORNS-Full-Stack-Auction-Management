import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Check, X, Edit2, Pencil, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function EditableCell({
  value,
  onSave,
  type = "text",
  options = [],
  disabled = false,
  placeholder = "Empty",
  singleLine = false,
}: {
  value: string;
  onSave: (val: string) => void | Promise<void>;
  type?: "text" | "textarea" | "select";
  options?: string[];
  disabled?: boolean;
  /** Fallback text shown in place of an empty value. Defaults to "Empty". */
  placeholder?: string;
  /**
   * Compact, truncate-with-tooltip collapsed display for narrow, inline
   * table cells (e.g. attendee name/email fields) instead of the default
   * wrap-and-clamp display sized for wider cells like item descriptions.
   */
  singleLine?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = async () => {
    if (tempValue === value) {
      setIsEditing(false);
      return;
    }
    setSaving(true);
    try {
      await onSave(tempValue);
      setIsEditing(false);
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 min-w-36 w-full">
        {type === "select" ? (
          <Select
            value={tempValue}
            onValueChange={(val) => setTempValue(val)}
            defaultOpen
            disabled={saving}
          >
            <SelectTrigger className="h-8 text-sm w-full">
              <SelectValue placeholder="Select..." />
            </SelectTrigger>
            <SelectContent>
              {options.map((opt) => (
                <SelectItem key={opt} value={opt}>
                  {opt}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : type === "textarea" ? (
          <Textarea
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            className="text-sm min-h-20 w-full"
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Escape") handleCancel();
            }}
          />
        ) : (
          <Input
            value={tempValue}
            onChange={(e) => setTempValue(e.target.value)}
            className="h-8 text-sm w-full"
            autoFocus
            disabled={saving}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-green-700 bg-green-100 hover:bg-green-200" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Check className="h-3 w-3 mr-1" />} Save
          </Button>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-red-700 bg-red-100 hover:bg-red-200" onClick={handleCancel} disabled={saving}>
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("group relative flex gap-2", singleLine ? "items-center" : "items-start")}>
      {singleLine ? (
        <span
          className={cn("text-base truncate", !value && "text-muted-foreground italic")}
          title={value || placeholder}
        >
          {value || placeholder}
        </span>
      ) : (
        <span className="whitespace-pre-wrap break-words overflow-hidden text-ellipsis line-clamp-6">
          {value || <span className="text-muted-foreground italic">{placeholder}</span>}
        </span>
      )}
      {!disabled && (
        <IconButton
          variant="ghost"
          aria-label="Edit"
          size={singleLine ? "icon-xs" : undefined}
          icon={singleLine ? <Pencil className="w-3.5 h-3.5" /> : <Edit2 className="h-3 w-3" />}
          className={cn(
            "opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0",
            singleLine ? "text-slate-400 hover:text-slate-700 hover:bg-transparent" : "h-5 w-5"
          )}
          onClick={() => setIsEditing(true)}
        />
      )}
    </div>
  );
}
