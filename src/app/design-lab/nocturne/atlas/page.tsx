import DesignLabShell from "@/components/design-lab/DesignLabShell";
import NocturneVariantNav from "@/components/design-lab/NocturneVariantNav";
import AtlasExperimentNav from "@/components/design-lab/AtlasExperimentNav";
import AtlasDashboard from "@/components/design-lab/AtlasDashboard";
import styles from "@/components/design-lab/nocturne-variants.module.css";

export default function NocturneAtlasPage() {
  return (
    <DesignLabShell active="nocturne" className={styles.atlasPage}>
      <NocturneVariantNav active="atlas" />
      <AtlasExperimentNav active="atlas" />
      <AtlasDashboard />
    </DesignLabShell>
  );
}
