import { useState } from "react";
import { toast } from "sonner";
import { fetchWithRetry, getBaseUrl } from "@/lib/google-api";
import { AuctionItem } from "@/types";

interface BundlingSelection {
  [rowIndex: number]: boolean;
}

export function useBundling(
  items: AuctionItem[],
  selectedRows: BundlingSelection,
  spreadsheetId: string | undefined,
  valueCalculations: { minRange: number, minRaise: number }[],
  onBundleComplete: () => void
) {
  const [isBundling, setIsBundling] = useState(false);
  const [bundleDetails, setBundleDetails] = useState<Partial<AuctionItem>>({});
  const [restoreBundleId, setRestoreBundleId] = useState("");
  const [isExecutingRestore, setIsExecutingRestore] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<string[]>([]);
  const [loadingSuggestions, setLoadingSuggestions] = useState(false);
  const [loadingDescription, setLoadingDescription] = useState(false);
  const [isExecutingBundle, setIsExecutingBundle] = useState(false);

  const parseDollar = (val: string) => {
    if (!val) return 0;
    const parsed = parseFloat(val.replace(/[^0-9.-]+/g, ""));
    return isNaN(parsed) ? 0 : parsed;
  };

  const calculateAutoBids = (valStr: string) => {
    const v = parseDollar(valStr);
    let opening = "";
    let raise = "";
    if (v > 0) {
      opening = `$${(v * 0.45).toFixed(2)}`;
      
      let calculatedRaise = 5;
      if (valueCalculations.length > 0) {
        const sorted = [...valueCalculations].sort((a,b) => a.minRange - b.minRange);
        for (const tier of sorted) {
          if (v >= tier.minRange) {
            calculatedRaise = tier.minRaise;
          }
        }
      } else {
        if (v < 150) calculatedRaise = 5;
        else if (v < 300) calculatedRaise = 10;
        else if (v < 450) calculatedRaise = 15;
        else if (v < 600) calculatedRaise = 20;
        else if (v < 750) calculatedRaise = 30;
        else if (v < 900) calculatedRaise = 40;
        else calculatedRaise = 50;
      }
      raise = `$${calculatedRaise.toFixed(2)}`;
    }
    return { opening, raise };
  };

  const handleRestoreBundle = async (tokenToRestore: string = restoreBundleId) => {
    if (!tokenToRestore) return;
    setRestoreBundleId(tokenToRestore);
    setIsExecutingRestore(true);
    const idempotencyKey = crypto.randomUUID?.() || Math.random().toString(36).substring(2);

    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bundle/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          targetBundleToken: tokenToRestore,
          idempotencyKey
        })
      });

      const data = await res.json();
      if (data.error) throw new Error(data.error);

      toast.success(`Bundle restored! Items: ${data.ui_history_log.original_item_names.join(', ')}`);
      setRestoreBundleId("");
      onBundleComplete();
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to restore bundle: " + e.message);
    } finally {
      setIsExecutingRestore(false);
    }
  };

  const openBundlingModal = () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    if (selectedItems.length < 2) {
      toast.error("Select at least 2 items to bundle");
      return;
    }

    const mergedDescription = selectedItems.map(i => `- ${i.name}: ${i.description}`).join('\n\n');
    const totalValue = selectedItems.reduce((sum, item) => sum + parseDollar(item.value), 0);
    const mergedDonor = Array.from(new Set(selectedItems.map(i => i.donor).filter(Boolean))).join(', ');
    const commonCategory = selectedItems[0].category;
    
    const { opening, raise } = calculateAutoBids(totalValue.toString());

    setBundleDetails({
      category: commonCategory,
      name: "",
      description: mergedDescription,
      value: totalValue > 0 ? `$${totalValue.toFixed(2)}` : "",
      donor: mergedDonor,
      openingBid: opening,
      minRaise: raise,
      itemType: selectedItems[0].itemType
    });
    setAiSuggestions([]);
    setIsBundling(true);
  };

  const getAiSuggestions = async () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    setLoadingSuggestions(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bundle/suggest-names`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems })
      });
      const data = await res.json();
      
      if (data.fallback) {
        toast.error("AI generation failed. Please enter a bundle name manually.");
        setAiSuggestions([
          "The Ultimate Collection",
          "Deluxe Surprise Package",
          "Premium Gala Bundle"
        ]);
        return;
      }
      
      if (data.error) throw new Error(data.error);
      setAiSuggestions(data.suggestions || []);
    } catch (e: any) {
      toast.error("AI naming failed: " + e.message);
    } finally {
      setLoadingSuggestions(false);
    }
  };

  const getAiDescriptionSuggestion = async () => {
    const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
    setLoadingDescription(true);
    try {
      const res = await fetchWithRetry(`${getBaseUrl()}/api/bundle/suggest-description`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: selectedItems })
      });
      const data = await res.json();
      
      if (data.fallback) {
        toast.error("AI generation failed. Please write a description manually.");
        setBundleDetails(prev => ({ 
          ...prev, 
          description: "An exclusive item collection bundled together for this special event. Don't miss out!" 
        }));
        return;
      }
      
      if (data.error) throw new Error(data.error);
      setBundleDetails(prev => ({ ...prev, description: data.description }));
      toast.success("AI description generated!");
    } catch (e: any) {
      toast.error("AI description failed: " + e.message);
    } finally {
      setLoadingDescription(false);
    }
  };

  const executeBundle = async () => {
    if (!bundleDetails.name || !bundleDetails.category) {
      toast.error("Bundle Name and Category are required");
      return;
    }

    setIsExecutingBundle(true);
    const idempotencyKey = crypto.randomUUID?.() || Math.random().toString(36).substring(2);

    try {
      const selectedItems = items.filter(i => selectedRows[i.rowIndex]);
      
      const ts = new Date().toLocaleString('en-US', { hour12: false }).replace(/\//g, '-');
      const bundleEventToken = "BND-" + ts.replace(/[^0-9]/g, '');

      // Background sync
      fetchWithRetry(`${getBaseUrl()}/api/bundle/process`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId,
          targetIds: selectedItems.map(i => i.id),
          newName: bundleDetails.name,
          newDescription: bundleDetails.description,
          targetCategory: bundleDetails.category,
          value: bundleDetails.value,
          openingBid: bundleDetails.openingBid,
          minRaise: bundleDetails.minRaise,
          donor: bundleDetails.donor,
          itemType: bundleDetails.itemType,
          bundleEventToken,
          idempotencyKey
        })
      })
      .then(async (res) => {
        const data = await res.json();
        if (data.error) throw new Error(data.error);

        toast.success(`Items bundled into "${data.ui_history_log.bundle_item_name}" successfully! Token: ${data.ui_history_log.bundle_token}`);
        setBundleDetails({});
        setIsBundling(false);
        onBundleComplete(); 
      })
      .catch((e: any) => {
        console.error("Bundle Error", e);
        toast.error("Failed to sync updates—retrying... local state reverted.");
      });
    } catch (e: any) {
      console.error(e);
      toast.error("Failed to sync updates—retrying... local state reverted.");
    } finally {
      setIsExecutingBundle(false);
    }
  };

  return {
    isBundling, setIsBundling,
    bundleDetails, setBundleDetails,
    aiSuggestions,
    loadingSuggestions,
    loadingDescription,
    isExecutingBundle,
    restoreBundleId, setRestoreBundleId,
    isExecutingRestore,
    openBundlingModal,
    getAiSuggestions,
    getAiDescriptionSuggestion,
    executeBundle,
    handleRestoreBundle
  };
}