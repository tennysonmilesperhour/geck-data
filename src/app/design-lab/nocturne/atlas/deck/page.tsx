import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import AtlasExperimentNav from "@/components/design-lab/AtlasExperimentNav";
import { AtlasDeckExperiment } from "@/components/design-lab/AtlasExperiments";
import atlasStyles from "@/components/design-lab/nocturne-variants.module.css";

export default function AtlasDeckPage() {
  return (
    <DesignLabShell active="nocturne" className={atlasStyles.atlasPage}>
      <NocturneVariantNav active="atlas" />
      <AtlasExperimentNav active="deck" />
      <AtlasDeckExperiment />
    </DesignLabShell>
  );
}
