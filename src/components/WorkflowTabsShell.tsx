import { ReactNode, useState } from "react";
import { ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { AuctionState } from "@/lib/auctionState";
import { AuctionStateBadge } from "@/components/AuctionStateBadge";

export interface WorkflowTab {
  value: string;
  label: string;
  content: ReactNode;
}

interface WorkflowTabsShellProps {
  title: string;
  description: string;
  spreadsheetId: string;
  auctionState?: AuctionState;
  tabs: WorkflowTab[];
  defaultTab: string;
  /**
   * Vertical alignment of the header row's two halves. AuctionItemsWorkflow.tsx
   * used "end" and AuctionTicketsWorkflow.tsx used "center" before this
   * extraction, with no evidence either was a deliberate choice rather
   * than copy-paste drift (see CHANGELOG.md's 2026-09-07
   * audit) - kept configurable, defaulting to "end", so extracting this
   * shell doesn't silently change either page's exact appearance.
   */
  headerAlign?: "end" | "center";
}

/**
 * Shared page shell for the two top-level workflow pages
 * (AuctionItemsWorkflow.tsx/AuctionTicketsWorkflow.tsx) - both hand-rolled
 * a near byte-identical header (title/description, the auction-state
 * badge, the "Open Spreadsheet" button) and tabs wrapper (a
 * horizontally-scrollable TabsList over TabsContent panes).
 */
export function WorkflowTabsShell({
  title,
  description,
  spreadsheetId,
  auctionState = "prep",
  tabs,
  defaultTab,
  headerAlign = "end",
}: WorkflowTabsShellProps) {
  const [activeTab, setActiveTab] = useState(defaultTab);

  return (
    <div className="space-y-6">
      <div
        className={cn(
          "flex flex-col sm:flex-row justify-between items-start gap-4 mb-6",
          headerAlign === "end" ? "sm:items-end" : "sm:items-center"
        )}
      >
        <div>
          <h2 className="text-2xl md:text-3xl font-bold tracking-tight">{title}</h2>
          <p className="text-muted-foreground mt-1 text-sm md:text-base">{description}</p>
        </div>
        <div className="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto">
          <AuctionStateBadge state={auctionState} className="order-first sm:order-none mb-2 sm:mb-0" />
          {spreadsheetId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.open(`https://docs.google.com/spreadsheets/d/${spreadsheetId}`, "_blank")}
              className="w-full sm:w-auto"
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Open Spreadsheet
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <div className="overflow-x-auto pb-2 -mx-6 px-6 md:mx-0 md:px-0">
          <TabsList className="bg-slate-200/50 p-1">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="gap-2 px-4 py-2">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        {tabs.map((tab) => (
          <TabsContent key={tab.value} value={tab.value} className="m-0">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
