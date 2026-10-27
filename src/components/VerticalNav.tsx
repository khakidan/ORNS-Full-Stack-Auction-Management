import type { ReactNode } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

export interface VerticalNavItem {
  value: string;
  label: string;
  icon?: ReactNode;
  /** Small count shown at the right, e.g. the number of rows in that section. */
  badge?: ReactNode;
}

interface VerticalNavProps {
  items: VerticalNavItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** Accessible name for the navigation. */
  label: string;
}

/**
 * Section navigation inside a tab: a left rail from `md` up, a dropdown
 * on phones (a rail would squeeze the content to nothing). Shows one
 * section at a time - the parent renders the matching panel.
 */
export function VerticalNav({ items, value, onValueChange, label }: VerticalNavProps) {
  return (
    <>
      <nav aria-label={label} className="hidden md:flex flex-col gap-1 w-52 shrink-0">
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              aria-current={active ? "page" : undefined}
              onClick={() => onValueChange(item.value)}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium text-left transition-colors",
                active ? "bg-secondary text-secondary-foreground" : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
              )}
            >
              {item.icon}
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge !== undefined && <span className="text-xs tabular-nums text-muted-foreground">{item.badge}</span>}
            </button>
          );
        })}
      </nav>

      <div className="md:hidden">
        <Select value={value} onValueChange={(v) => v && onValueChange(v)}>
          <SelectTrigger aria-label={label} className="h-10 w-full">
            <SelectValue>{(v: string) => items.find((i) => i.value === v)?.label ?? v}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </>
  );
}
