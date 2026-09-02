import type { ComponentProps, ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface LoadingButtonProps extends Omit<ComponentProps<typeof Button>, "children"> {
  loading: boolean;
  /**
   * Replaces the button's children while loading (e.g. "Sending..."). Pass
   * `null` for a spinner with no label at all. Omit to keep the same
   * label and only swap the icon for a spinner.
   */
  loadingText?: ReactNode;
  /** Idle-state icon shown before children - swapped for a spinner while loading. */
  icon?: ReactNode;
  loaderClassName?: string;
  children?: ReactNode;
}

/**
 * Wraps Button to natively handle busy/submitting state: auto-disables
 * and shows a spinner in place of the idle icon, consolidating what used
 * to be independently hand-rolled `{loading ? <Loader2 .../> : ...}`
 * pairs at every call site (see refactor-opportunities.md).
 */
export function LoadingButton({
  loading,
  loadingText,
  icon,
  loaderClassName = "w-4 h-4",
  disabled,
  children,
  ...props
}: LoadingButtonProps) {
  return (
    <Button disabled={loading || disabled} {...props}>
      {loading ? <Loader2 className={cn(loaderClassName, "animate-spin")} /> : icon}
      {loading && loadingText !== undefined ? loadingText : children}
    </Button>
  );
}
