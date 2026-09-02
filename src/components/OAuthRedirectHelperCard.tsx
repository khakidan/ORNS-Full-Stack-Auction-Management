import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Copy, CheckSquare } from "lucide-react";

interface OAuthRedirectHelperCardProps {
  redirectUri: string;
  copySuccess: boolean;
  onCopy: () => Promise<void>;
}

export default function OAuthRedirectHelperCard({ redirectUri, copySuccess, onCopy }: OAuthRedirectHelperCardProps) {
  return (
    <Card className="hidden">
      <CardHeader>
        <CardTitle>Google OAuth Helper</CardTitle>
        <CardDescription>
          Your Google Cloud Console must have this exact Authorised redirect URI:
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-2">
          <code className="bg-slate-100 p-2 rounded text-xs flex-1 border font-mono truncate">
            {redirectUri}
          </code>
          <Button variant="outline" size="sm" onClick={onCopy} className="gap-2 shrink-0">
            {copySuccess ? <CheckSquare className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
            {copySuccess ? "Copied" : "Copy"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
