import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatusStatePlaceholderProps {
  icon?: ReactNode;
  title?: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  /** Dashed-border box treatment instead of a plain centered block. */
  bordered?: boolean;
  className?: string;
}

/**
 * Shared "nothing to show" block: centered muted icon, optional bold
 * heading, descriptive text, optional action. Consolidates what used to
 * be independently hand-written per screen for both empty results and
 * unconfigured-setting states (see CHANGELOG.md). Does not
 * include its own Card wrapper - compose it inside <Card>/<CardContent>
 * (or a grid cell, via `className`) the same way the rest of this app
 * composes Card content.
 */
export function StatusStatePlaceholder({
  icon,
  title,
  description,
  action,
  bordered = false,
  className,
}: StatusStatePlaceholderProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-2 py-12 text-center",
        bordered && "border-2 border-dashed rounded-lg",
        className
      )}
    >
      {icon && (
        <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mb-2 text-slate-300 [&_svg]:size-8">
          {icon}
        </div>
      )}
      {title && <h3 className="text-lg font-semibold">{title}</h3>}
      <div className="text-muted-foreground max-w-md">{description}</div>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
