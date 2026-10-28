import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

export type WorkflowType = "tickets" | "items" | "bids" | "settings" | "archive";

const WORKFLOW_PATHS: Record<WorkflowType, string> = {
  items: "/AuctionItemsWorkflow",
  tickets: "/AuctionTicketsWorkflow",
  bids: "/BidManagement",
  settings: "/Settings",
  archive: "/ArchivedAuctions",
};

export const WORKFLOW_LABELS: Record<WorkflowType, string> = {
  items: "Items",
  tickets: "Tickets",
  bids: "Bids",
  settings: "Settings",
  archive: "Archive",
};

export function getWorkflowFromPath(path: string): WorkflowType | null {
  const cleanPath = path.toLowerCase();
  if (cleanPath.includes("archive")) return "archive";
  if (cleanPath.includes("items")) return "items";
  if (cleanPath.includes("tickets")) return "tickets";
  if (cleanPath.includes("bid")) return "bids";
  if (cleanPath.includes("config") || cleanPath.includes("bugreports") || cleanPath.includes("settings") || cleanPath.includes("configuration")) return "settings";
  return null;
}

function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // A blocked localStorage only loses the remembered tab.
  }
}

/**
 * Which workflow and Bid Management tab are showing. What was asked for
 * (a click, the URL, the remembered tab) is kept as is; what the person
 * may see is worked out from it during render, so a volunteer or a
 * non-admin never shows a page they can't use, even for a frame
 * (ROADMAP A14 - this used to be corrected afterwards in effects):
 * - a volunteer sees only Bid Management, and not its Items tab;
 * - Settings is Full Administrator only - anyone else gets Bid Management.
 */
export function useWorkflowNavigation() {
  const { user, can } = useAuth();
  const isVolunteer = user?.role === "volunteer";

  const [requestedWorkflow, setActiveWorkflow] = useState<WorkflowType>(
    () => getWorkflowFromPath(window.location.pathname) || (readStored("activeWorkflow") as WorkflowType) || "settings"
  );
  const [requestedBidTab, setActiveBidTab] = useState(() => readStored("activeBidTab") || "dashboard");

  const activeWorkflow: WorkflowType =
    isVolunteer || (user && requestedWorkflow === "settings" && !can("settings")) ? "bids" : requestedWorkflow;
  const activeBidTab = isVolunteer && requestedBidTab === "items" ? "dashboard" : requestedBidTab;

  // The URL and the remembered tab follow what is actually showing.
  useEffect(() => {
    writeStored("activeWorkflow", activeWorkflow);
    const targetPath = WORKFLOW_PATHS[activeWorkflow];
    if (window.location.pathname !== targetPath) window.history.pushState(null, "", targetPath);
  }, [activeWorkflow]);

  useEffect(() => {
    writeStored("activeBidTab", activeBidTab);
  }, [activeBidTab]);

  // Browser back/forward.
  useEffect(() => {
    const handlePopState = () => {
      const pathWorkflow = getWorkflowFromPath(window.location.pathname);
      if (pathWorkflow) setActiveWorkflow(pathWorkflow);
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  return { activeWorkflow, setActiveWorkflow, activeBidTab, setActiveBidTab, isVolunteer };
}
