import { useId } from "react";
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter 
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoadingButton } from "@/components/ui/LoadingButton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { 
  Select, 
  SelectContent, 
  SelectItem, 
  SelectTrigger, 
  SelectValue 
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Package, Wand2 } from "lucide-react";
import { AuctionItem } from "@/types";

interface BundlingDialogProps {
  isBundling: boolean;
  setIsBundling: (open: boolean) => void;
  bundleDetails: Partial<AuctionItem>;
  setBundleDetails: (details: Partial<AuctionItem>) => void;
  categories: string[];
  getAiSuggestions: () => Promise<void>;
  aiSuggestions: string[];
  loadingSuggestions: boolean;
  getAiDescriptionSuggestion: () => Promise<void>;
  loadingDescription: boolean;
  executeBundle: () => Promise<void>;
  isExecutingBundle: boolean;
}

export function BundlingDialog({
  isBundling,
  setIsBundling,
  bundleDetails,
  setBundleDetails,
  categories,
  getAiSuggestions,
  aiSuggestions,
  loadingSuggestions,
  getAiDescriptionSuggestion,
  loadingDescription,
  executeBundle,
  isExecutingBundle
}: BundlingDialogProps) {
  const id = useId();
  return (
    <Dialog open={isBundling} onOpenChange={setIsBundling}>
      <DialogContent className="sm:max-w-[700px] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-6 h-6 text-primary" /> Bundle Auction Items
          </DialogTitle>
          <DialogDescription>
            This will combine items into one new package.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-6 py-4">
          <div className="space-y-4">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`${id}-name`} className="text-sm font-bold">Bundle Name *</Label>
                <LoadingButton
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-primary hover:text-primary animate-pulse flex items-center gap-1"
                  onClick={getAiSuggestions}
                  loading={loadingSuggestions}
                  icon={<Wand2 className="w-3 h-3" />}
                  loaderClassName="w-3 h-3"
                >
                  Ask Gemini for Ideas
                </LoadingButton>
              </div>
              
              {aiSuggestions.length > 0 && (
                <div className="bg-primary/5 p-3 rounded-lg border border-primary/20 space-y-2 mb-3">
                  <span className="text-xxs font-bold text-primary uppercase">Suggested by Gemini:</span>
                  <div className="flex flex-wrap gap-2">
                    {aiSuggestions.map((name, i) => (
                      <Badge 
                        key={i} 
                        variant="secondary" 
                        className="cursor-pointer hover:bg-primary hover:text-white transition-colors"
                        onClick={() => setBundleDetails({...bundleDetails, name})}
                      >
                        {name}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              <Input
                id={`${id}-name`}
                placeholder="e.g. The Ultimate Family Staycation Pack" 
                value={bundleDetails.name || ""} 
                onChange={(e) => setBundleDetails({...bundleDetails, name: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${id}-category`} className="text-sm font-bold">Category *</Label>
                <Select value={bundleDetails.category} onValueChange={(val) => setBundleDetails({...bundleDetails, category: val})}>
                  <SelectTrigger id={`${id}-category`}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {categories.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-value`} className="text-sm font-bold">Total Value (Calculated)</Label>
                <Input
                  id={`${id}-value`}
                  value={bundleDetails.value || ""} 
                  onChange={(e) => setBundleDetails({...bundleDetails, value: e.target.value})}
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor={`${id}-description`} className="text-sm font-bold text-muted-foreground">Description</Label>
                <LoadingButton
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-primary hover:text-primary flex items-center gap-1"
                  onClick={getAiDescriptionSuggestion}
                  loading={loadingDescription}
                  icon={<Wand2 className="w-3 h-3" />}
                  loaderClassName="w-3 h-3"
                >
                  Ask Gemini for Description
                </LoadingButton>
              </div>
              <Textarea
                id={`${id}-description`}
                className="min-h-37.5 text-xs font-mono"
                value={bundleDetails.description || ""} 
                onChange={(e) => setBundleDetails({...bundleDetails, description: e.target.value})}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor={`${id}-opening`} className="text-sm font-bold">Opening Bid</Label>
                <Input id={`${id}-opening`} value={bundleDetails.openingBid || ""} onChange={(e) => setBundleDetails({...bundleDetails, openingBid: e.target.value})} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-raise`} className="text-sm font-bold">Min Raise</Label>
                <Input id={`${id}-raise`} value={bundleDetails.minRaise || ""} onChange={(e) => setBundleDetails({...bundleDetails, minRaise: e.target.value})} />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`${id}-donor`} className="text-sm font-bold">Donors (Combined)</Label>
              <Input id={`${id}-donor`} value={bundleDetails.donor || ""} onChange={(e) => setBundleDetails({...bundleDetails, donor: e.target.value})} />
            </div>
          </div>
        </div>

        <DialogFooter className="bg-slate-50 -mx-6 -mb-6 p-6">
          <Button variant="outline" onClick={() => setIsBundling(false)}>Cancel</Button>
          <LoadingButton
            onClick={executeBundle}
            loading={isExecutingBundle}
            icon={<Package className="w-4 h-4" />}
            className="bg-primary text-white hover:bg-primary/90 flex items-center gap-2"
          >
            Confirm Bundle & Merge Rows
          </LoadingButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
