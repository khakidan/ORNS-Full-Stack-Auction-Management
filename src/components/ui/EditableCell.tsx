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
import { Check, X, Edit2 } from "lucide-react";

export function EditableCell({ 
  value, 
  onSave, 
  type = "text",
  options = [],
  disabled = false
}: { 
  value: string; 
  onSave: (val: string) => void; 
  type?: "text" | "textarea" | "select";
  options?: string[];
  disabled?: boolean;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [tempValue, setTempValue] = useState(value);

  useEffect(() => {
    setTempValue(value);
  }, [value]);

  const handleSave = () => {
    onSave(tempValue);
    setIsEditing(false);
  };

  const handleCancel = () => {
    setTempValue(value);
    setIsEditing(false);
  };

  if (isEditing) {
    return (
      <div className="flex flex-col gap-2 min-w-[9rem] w-full">
        {type === "select" ? (
          <Select 
            value={tempValue} 
            onValueChange={(val) => setTempValue(val)}
            defaultOpen
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
            className="text-sm min-h-[80px] w-full"
            autoFocus
          />
        ) : (
          <Input 
            value={tempValue} 
            onChange={(e) => setTempValue(e.target.value)} 
            className="h-8 text-sm w-full"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-green-700 bg-green-100 hover:bg-green-200" onClick={handleSave}>
            <Check className="h-3 w-3 mr-1" /> Save
          </Button>
          <Button size="sm" variant="secondary" className="h-6 px-2 text-xs text-red-700 bg-red-100 hover:bg-red-200" onClick={handleCancel}>
            <X className="h-3 w-3 mr-1" /> Cancel
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="group relative flex items-start gap-2">
      <span className="whitespace-pre-wrap break-words overflow-hidden text-ellipsis line-clamp-6">
        {value || <span className="text-muted-foreground italic">Empty</span>}
      </span>
      {!disabled && (
        <IconButton
          variant="ghost"
          aria-label="Edit"
          icon={<Edit2 className="h-3 w-3" />}
          className="h-5 w-5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
          onClick={() => setIsEditing(true)}
        />
      )}
    </div>
  );
}
