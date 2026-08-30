import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import AtlasExperimentNav from "@/components/design-lab/AtlasExperimentNav";
import { AtlasRankExperiment } from "@/components/design-lab/AtlasExperiments";
import atlasStyles from "@/components/design-lab/nocturne-variants.module.css";

export default function AtlasRankPage() {
  return (
    <DesignLabShell active="nocturne" className={atlasStyles.atlasPage}>
      <NocturneVariantNav active="atlas" />
      <AtlasExperimentNav active="rank" />
      <AtlasRankExperiment />
    </DesignLabShell>
  );
}
