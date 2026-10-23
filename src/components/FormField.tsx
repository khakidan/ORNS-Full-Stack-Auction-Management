import { ReactNode, useId } from "react";
import { Label } from "@/components/ui/label";

interface FormFieldProps {
  label: ReactNode;
  className?: string;
  /** Renders the control; pass `id` to the Input/Textarea (or a Select's SelectTrigger). */
  children: (id: string) => ReactNode;
}

/**
 * One labelled field in the add/edit dialogs: the small muted label above
 * its control, linked by a generated id so clicking the label focuses the
 * control and screen readers announce it. Used inside FormSection.
 */
export function FormField({ label, className, children }: FormFieldProps) {
  const id = useId();
  return (
    <div className={className}>
      <Label htmlFor={id} className="text-xs text-muted-foreground mb-1.5 block">{label}</Label>
      {children(id)}
    </div>
  );
}
