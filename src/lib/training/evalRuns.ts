// Server-side fetcher for the /data-admin/training/evals dashboard.
// One place to shape the data so the page component stays focused on layout.

import { createClient } from "@/lib/supabase/server";

export type EvalRun = {
  id: number;
  started_at: string;
  finished_at: string | null;
  status: "running" | "success" | "failed";
  model: string | null;
  split: string;
  eval_set_size: number;
  primary_morph_top1_accuracy: number | null;
  genetic_jaccard_avg: number | null;
  base_color_accuracy: number | null;
  per_trait_metrics: Record<string, {
    precision: number; recall: number; f1: number; support: number; predicted: number;
  }>;
  top_confusions: Array<{ label: string; predicted: string; count: number }>;
  notes: string | null;
  prompt_fingerprint: string | null;
  triggered_by: string | null;
  error_message: string | null;
};

export async function getEvalRuns(limit = 50): Promise<EvalRun[]> {
  const supabase = createClient();
  const { data } = await supabase
    .from("morph_eval_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  return (data ?? []) as EvalRun[];
}
