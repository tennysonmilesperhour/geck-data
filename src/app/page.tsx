import AtlasDashboard from "@/components/design-lab/AtlasDashboard";
import { getAtlasSnapshot } from "@/lib/landing/atlas";

export const dynamic = "force-dynamic";

/**
 * The production home now uses the approved Atlas information architecture,
 * not a collection of conventional dashboard cards styled to resemble it.
 * Its snapshot is assembled on the server from current listing observations
 * and separately sourced sold pools, then handed to the interactive orbit as
 * one small serializable object.
 */
export default async function LandingPage() {
  const snapshot = await getAtlasSnapshot();
  return <AtlasDashboard snapshot={snapshot} production />;
}
