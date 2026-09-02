import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Cloud, CloudOff, LogIn } from "lucide-react";
import type { User } from "firebase/auth";
import { cn } from "@/lib/utils";

interface CloudSyncStatusCardProps {
  firebaseUser: User | null;
  loginToFirebase: () => Promise<void>;
}

export default function CloudSyncStatusCard({ firebaseUser, loginToFirebase }: CloudSyncStatusCardProps) {
  return (
    <Card className={cn(firebaseUser ? "border-emerald-200 bg-emerald-50/10" : "border-amber-200 bg-amber-50/10")}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            {firebaseUser ? <Cloud className="w-5 h-5 text-emerald-600" /> : <CloudOff className="w-5 h-5 text-amber-600" />}
            Cloud Sync Status
          </CardTitle>
          {firebaseUser ? (
            <div className="flex items-center gap-2 text-xs font-medium text-emerald-700 bg-emerald-100 px-2 py-1 rounded-full">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Synced: {firebaseUser.email}
            </div>
          ) : (
             <div className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-1 rounded-full">
              Offline Sync
            </div>
          )}
        </div>
        <CardDescription>
          {firebaseUser
            ? "Your configuration is automatically backed up and synced across all your devices."
            : "Settings are currently only saved on this device. Sign in to enable cross-device synchronization."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {!firebaseUser && (
          <Button variant="outline" onClick={loginToFirebase} className="w-full gap-2 border-amber-300 hover:bg-amber-100/50">
            <LogIn className="w-4 h-4" />
            Sign in to Sync Across Devices
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
