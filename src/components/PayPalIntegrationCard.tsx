import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Config } from "@/types";

interface PayPalIntegrationCardProps {
  config: Config;
  setConfig: React.Dispatch<React.SetStateAction<Config>>;
}

export default function PayPalIntegrationCard({ config, setConfig }: PayPalIntegrationCardProps) {
  const isSandbox = config.paypalIsSandbox;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <div>
            <CardTitle>PayPal Integration</CardTitle>
            <CardDescription>Controls whether PayPal invoices are created against PayPal's test environment or the real, live account.</CardDescription>
          </div>
          <Badge variant={isSandbox ? "secondary" : "destructive"}>
            {isSandbox ? "Sandbox" : "Production"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-start gap-3">
          <Checkbox
            id="paypalIsSandbox"
            checked={isSandbox}
            onCheckedChange={(checked) => setConfig({ ...config, paypalIsSandbox: checked === true })}
          />
          <Label htmlFor="paypalIsSandbox" className="font-normal leading-snug">
            Sandbox Mode (Test) - no real invoices are created and no emails are sent to bidders.
          </Label>
        </div>
        {!isSandbox && (
          <p className="text-xs text-destructive font-medium">
            Production mode is on. Invoices created from here will be real PayPal invoices, emailed to real bidders.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
