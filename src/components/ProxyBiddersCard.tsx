import { UserCheck } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bidder } from "@/types";

interface ProxyBiddersCardProps {
  proxyBidders: Bidder[];
}

export function ProxyBiddersCard({ proxyBidders }: ProxyBiddersCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <UserCheck className="w-5 h-5 text-amber-600" />
          Proxy Bidders ({proxyBidders.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="h-[320px]">
        <ScrollArea className="h-full pr-4">
          {proxyBidders.length > 0 ? (
            <div className="space-y-2">
              {proxyBidders.map((bidder) => (
                <div
                  key={bidder.id}
                  className="flex items-center justify-between bg-slate-50 dark:bg-slate-800 rounded-lg px-4 py-3 border border-slate-200"
                >
                  <div className="font-mono font-bold text-primary">
                    #{bidder.id}
                  </div>
                  <div className="font-medium">
                    {bidder.firstName} {bidder.lastName}
                  </div>
                  <div className="text-xs text-amber-600 font-medium">PROXY</div>
                </div>
              ))}
            </div>
          ) : (
            <div className="h-full flex items-center justify-center text-muted-foreground">
              No proxy bidders yet.
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  );
}
