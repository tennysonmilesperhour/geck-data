// Full-page settings view — same body as the drawer, just roomier.
import ChartSettingsPanel from "@/components/settings/ChartSettingsPanel";
import { SectionHeader } from "@/components/ui/Panel";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Settings · Geck Inspect",
};

export default function SettingsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <SectionHeader
        eyebrow="Settings"
        title="Chart customization"
        description="Pick a preset or toggle individual charts per page. Changes are stored on this device."
      />
      <ChartSettingsPanel />
    </div>
  );
}
