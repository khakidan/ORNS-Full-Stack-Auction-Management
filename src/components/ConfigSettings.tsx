import { LoadingButton } from "@/components/ui/LoadingButton";
import { Save } from "lucide-react";
import { useConfigSettingsState } from "@/hooks/useConfigSettingsState";
import CloudSyncStatusCard from "./CloudSyncStatusCard";
import SetupNewAuctionCard from "./SetupNewAuctionCard";
import AuctionConfigurationCard from "./AuctionConfigurationCard";
import TicketPricingCard from "./TicketPricingCard";
import ArchiveAuctionCard from "./ArchiveAuctionCard";
import PayPalIntegrationCard from "./PayPalIntegrationCard";
import PayPalSweeperStatusCard from "./PayPalSweeperStatusCard";
import AppsScriptVersionsCard from "./AppsScriptVersionsCard";
import ManualCopyDialog from "./ManualCopyDialog";
import BugReportsAdmin from "./BugReportsAdmin";
import { WorkflowTabsShell } from "@/components/WorkflowTabsShell";
import { useAuction } from "@/context/AuctionContext";

export default function ConfigSettings() {
  const {
    config,
    setConfig,
    firebaseUser,
    loginToFirebase,
    savingSettings,
    isSettingUpNewAuction,
    showManualCopyDialog,
    setShowManualCopyDialog,
    auctionYear,
    isAuctionConfigOpen,
    setIsAuctionConfigOpen,
    handleSetupNewAuction,
    handleSave,
  } = useConfigSettingsState();
  const { isAuctionClosed } = useAuction();

  // PayPal and Settings both edit the same `config` draft, so each carries
  // the same Save button.
  const saveButton = (
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
  );

  const paypalTab = (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <PayPalIntegrationCard config={config} setConfig={setConfig} />
        <PayPalSweeperStatusCard />
      </div>
      {saveButton}
    </div>
  );

  // Like the Dashboard tab: cards sit side by side and each is only as tall
  // as its content (items-start). Cloud Sync spans the full width, the two
  // archive cards share a row, and Auction Configuration takes the rest of
  // the last row beside Ticket Pricing (one third).
  const settingsTab = (
    <div className="space-y-6">
      <CloudSyncStatusCard firebaseUser={firebaseUser} loginToFirebase={loginToFirebase} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <ArchiveAuctionCard config={config} />

        <SetupNewAuctionCard
          isSettingUpNewAuction={isSettingUpNewAuction}
          onRun={handleSetupNewAuction}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
        <div className="lg:col-span-2">
          <AuctionConfigurationCard
            config={config}
            setConfig={setConfig}
            isOpen={isAuctionConfigOpen}
            onToggle={() => setIsAuctionConfigOpen(!isAuctionConfigOpen)}
          />
        </div>

        <TicketPricingCard config={config} setConfig={setConfig} />
      </div>

      {saveButton}

      <ManualCopyDialog open={showManualCopyDialog} onOpenChange={setShowManualCopyDialog} auctionYear={auctionYear} />
    </div>
  );

  return (
    <WorkflowTabsShell
      title="Configuration"
      description="Auction settings, PayPal, Apps Script status, and in-app bug reports."
      spreadsheetId=""
      isAuctionClosed={isAuctionClosed}
      defaultTab="settings"
      tabs={[
        { value: "settings", label: "Settings", content: settingsTab },
        { value: "paypal", label: "PayPal Integration", content: paypalTab },
        {
          value: "apps_script",
          label: "Google Apps Scripts",
          content: (
            <AppsScriptVersionsCard />
          ),
        },
        { value: "bug_reports", label: "Bug Reports", content: <BugReportsAdmin /> },
      ]}
    />
  );
}
