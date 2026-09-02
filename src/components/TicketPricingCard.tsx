import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Config } from "@/types";

interface TicketPricingCardProps {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

export default function TicketPricingCard({ config, setConfig }: TicketPricingCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Ticket Pricing</CardTitle>
        <CardDescription>Configure the standard walk-in ticket price for the event.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-w-sm">
          <Label htmlFor="ticketPrice">Walk-In Ticket Price ($)</Label>
          <Input
            id="ticketPrice"
            type="number"
            placeholder="35"
            value={config.ticketPrice}
            onChange={(e) => setConfig({ ...config, ticketPrice: e.target.value })}
          />
        </div>
      </CardContent>
    </Card>
  );
}
