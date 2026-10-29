import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Config } from "@/types";

interface TicketPricingCardProps {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

/**
 * The walk-in ticket price. Set Up Bid Management App takes it from the
 * website's ticket form (server/services/ticketPriceFromWebsite.ts); once it
 * has, the price is shown read-only - the server keeps it on a save anyway.
 */
export default function TicketPricingCard({ config, setConfig }: TicketPricingCardProps) {
  const fromWebsiteAt = config.ticketPriceFromWebsiteAt ? new Date(config.ticketPriceFromWebsiteAt) : null;
  const fromWebsite = !!fromWebsiteAt && !Number.isNaN(fromWebsiteAt.getTime());
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket Pricing</CardTitle>
        <CardDescription>
          The walk-in ticket price for the event. Set Up Bid Management App sets it to the price the website's ticket form charges.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="ticketPrice">Walk-In Ticket Price ($)</Label>
          <Input
            id="ticketPrice"
            type="number"
            placeholder="35"
            value={config.ticketPrice}
            readOnly={fromWebsite}
            aria-describedby={fromWebsite ? "ticketPriceSource" : undefined}
            onChange={(e) => setConfig({ ...config, ticketPrice: e.target.value })}
          />
          {fromWebsite && (
            <p id="ticketPriceSource" className="text-xs text-muted-foreground">
              From the website's ticket form, checked {fromWebsiteAt!.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}. To change it, change the price on the form and run Set Up Bid Management App again.
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
