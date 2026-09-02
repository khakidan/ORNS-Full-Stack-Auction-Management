import type { ComponentProps, ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "size" | "children" | "aria-label"> {
  icon: ReactNode;
  /** Required - an icon-only button is meaningless to a screen reader without one. */
  "aria-label": string;
  size?: "icon-xs" | "icon-sm" | "icon" | "icon-lg";
}

/**
 * Icon-only button. Wraps Button with `size` locked to the icon variants
 * and `aria-label` required at the type level, so an icon-only button
 * can't ship without an accessible label the way a plain
 * `<Button size="icon">` could (see component-standards.md and the
 * accessibility finding in refactor-opportunities.md this component
 * replaces).
 */
export function IconButton({ icon, size = "icon", ...props }: IconButtonProps) {
  return (
    <Button size={size} {...props}>
      {icon}
    </Button>
  );
}
