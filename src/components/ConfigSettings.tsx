import { LoadingButton } from "@/components/ui/LoadingButton";
import { Save } from "lucide-react";
import { useConfigSettingsState } from "@/hooks/useConfigSettingsState";
import CloudSyncStatusCard from "./CloudSyncStatusCard";
import OAuthRedirectHelperCard from "./OAuthRedirectHelperCard";
import SetupNewAuctionCard from "./SetupNewAuctionCard";
import AuctionConfigurationCard from "./AuctionConfigurationCard";
import TicketPricingCard from "./TicketPricingCard";
import ManualCopyDialog from "./ManualCopyDialog";

export default function ConfigSettings() {
  const {
    config,
    setConfig,
    firebaseUser,
    loginToFirebase,
    savingSettings,
    copySuccess,
    isSettingUpNewAuction,
    showManualCopyDialog,
    setShowManualCopyDialog,
    auctionYear,
    isAuctionConfigOpen,
    setIsAuctionConfigOpen,
    isSetupNewAuctionOpen,
    setIsSetupNewAuctionOpen,
    redirectUri,
    handleSetupNewAuction,
    copyToClipboard,
    handleSave,
  } = useConfigSettingsState();

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <CloudSyncStatusCard firebaseUser={firebaseUser} loginToFirebase={loginToFirebase} />

      <OAuthRedirectHelperCard redirectUri={redirectUri} copySuccess={copySuccess} onCopy={copyToClipboard} />

      <SetupNewAuctionCard
        isOpen={isSetupNewAuctionOpen}
        onToggle={() => setIsSetupNewAuctionOpen(!isSetupNewAuctionOpen)}
        isSettingUpNewAuction={isSettingUpNewAuction}
        onRun={handleSetupNewAuction}
      />

      <AuctionConfigurationCard
        config={config}
        setConfig={setConfig}
        isOpen={isAuctionConfigOpen}
        onToggle={() => setIsAuctionConfigOpen(!isAuctionConfigOpen)}
      />

      <TicketPricingCard config={config} setConfig={setConfig} />

      <div className="flex flex-col sm:flex-row gap-3 pt-6 pb-6">
        <LoadingButton
          onClick={handleSave}
          loading={savingSettings}
          icon={<Save className="w-5 h-5" />}
          loaderClassName="w-5 h-5"
          className="flex-1 gap-2 h-12 text-md"
        >
          Save Configuration
        </LoadingButton>
      </div>

      <ManualCopyDialog open={showManualCopyDialog} onOpenChange={setShowManualCopyDialog} auctionYear={auctionYear} />
    </div>
  );
}
