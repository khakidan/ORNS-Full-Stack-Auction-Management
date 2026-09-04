import { ReactNode } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Download, Loader2 } from "lucide-react";

interface DocumentCreationPanelProps {
  description: string;
  isAuctionClosed: boolean;
  /** Vertical spacing between generation buttons - the two consumers differ (2 vs 8 buttons). */
  buttonSpacingClassName?: string;
  children: ReactNode;
}

/**
 * "Creation Tools" card chrome (icon/title, description, closed-auction
 * note, "documents go to your For Print folder" footer) around a set of
 * generation buttons passed as children. Previously hand-copied
 * identically between DocumentCreationTab.tsx and
 * TicketDocumentCreationTab.tsx, which differ only in their button list
 * and description text.
 */
export function DocumentCreationPanel({
  description,
  isAuctionClosed,
  buttonSpacingClassName = "space-y-2",
  children,
}: DocumentCreationPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5 text-primary" />
          Creation Tools
        </CardTitle>
        <CardDescription>
          {description}
        </CardDescription>
      </CardHeader>
      <CardContent className={buttonSpacingClassName}>
        {children}

        {isAuctionClosed && (
          <p className="text-xs text-amber-600 bg-amber-50 p-2 rounded border border-amber-100 flex items-center gap-2 mt-4">
            <Loader2 className="w-3 h-3 animate-pulse" />
            Auction Closed: Creation tools disabled.
          </p>
        )}

        <p className="text-xxs text-muted-foreground mt-4 px-1 italic">
          Note: Documents will be placed in your For Print folder.
        </p>
      </CardContent>
    </Card>
  );
}
