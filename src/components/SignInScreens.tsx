import { Loader2, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** While the sign-in check is still running. */
export function AuthLoadingScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50">
      <Loader2 className="w-8 h-8 animate-spin text-primary" />
    </div>
  );
}

/** A volunteer whose access ended when the auction closed. */
export function VolunteerThanksScreen() {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-1">
          <CardTitle className="text-2xl font-bold tracking-tight">Thanks for volunteering!</CardTitle>
          <CardDescription className="text-base">
            The auction has closed, so your access to the app has ended. If you still need it, ask an auction organizer for a new link.
          </CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}

export function SignInScreen({ onSignIn }: { onSignIn: () => void }) {
  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-50 px-4">
      <Card className="w-full max-w-md shadow-lg">
        <CardHeader className="text-center space-y-1">
          <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-4">
            <ShoppingBag className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-3xl font-bold tracking-tight">ORNS Auction</CardTitle>
          <CardDescription className="text-lg">
            Next-level charity auction management
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-center text-muted-foreground text-sm">
            Manage this year's ORNS Auction with Google Sheets & Drive.
          </p>

          <Button onClick={onSignIn} size="lg" className="w-full text-md py-6 shadow-md hover:shadow-lg transition-all gap-3">
            <ShoppingBag className="w-6 h-6" />
            Sign in with @orns.org
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
