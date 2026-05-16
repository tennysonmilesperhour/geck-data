"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";
import { parseTraitList } from "@/lib/traits";

export type ForceInput = {
  cached_traits: string | null;
  norm_traits: string | null;
};

type Node = d3.SimulationNodeDatum & { id: string; count: number };
type Edge = d3.SimulationLinkDatum<Node> & {
  source: string | Node;
  target: string | Node;
  count: number;
};

export default function ForceGraph({
  data,
  topN = 30,
  minPair = 5,
}: {
  data: ForceInput[];
  topN?: number;
  minPair?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { nodes, edges } = useMemo(() => {
    const traitCount = new Map<string, number>();
    const pairCount = new Map<string, number>();
    for (const d of data) {
      const tokens = parseTraitList(d);
      for (const t of tokens) traitCount.set(t, (traitCount.get(t) ?? 0) + 1);
      for (let i = 0; i < tokens.length; i++) {
        for (let j = i + 1; j < tokens.length; j++) {
          const pair = [tokens[i], tokens[j]].sort();
          const key = `${pair[0]}|${pair[1]}`;
          pairCount.set(key, (pairCount.get(key) ?? 0) + 1);
        }
      }
    }
    const topTraits = new Set(
      Array.from(traitCount.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, topN)
        .map(([t]) => t),
    );
    const nodes: Node[] = Array.from(topTraits).map((t) => ({
      id: t,
      count: traitCount.get(t) ?? 0,
    }));
    const edges: Edge[] = [];
    for (const [key, count] of pairCount.entries()) {
      if (count < minPair) continue;
      const [a, b] = key.split("|");
      if (!topTraits.has(a) || !topTraits.has(b)) continue;
      edges.push({ source: a, target: b, count });
    }
    return { nodes, edges };
  }, [data, topN, minPair]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || nodes.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 540;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const maxCount = d3.max(nodes, (n) => n.count) ?? 1;
    const r = d3.scaleSqrt().domain([0, maxCount]).range([4, 22]);
    const maxEdge = d3.max(edges, (e) => e.count) ?? 1;
    const ew = d3.scaleLinear().domain([0, maxEdge]).range([0.5, 4]);

    const simNodes: Node[] = nodes.map((n) => ({ ...n }));
    const simEdges: Edge[] = edges.map((e) => ({ ...e }));

    const sim = d3
      .forceSimulation<Node>(simNodes)
      .force(
        "link",
        d3
          .forceLink<Node, Edge>(simEdges)
          .id((d) => d.id)
          .distance((e) => 90 - Math.min(70, e.count))
          .strength(0.4),
      )
      .force("charge", d3.forceManyBody<Node>().strength(-240))
      .force("center", d3.forceCenter(W / 2, H / 2))
      .force(
        "collide",
        d3.forceCollide<Node>().radius((d) => r(d.count) + 2),
      )
      .stop();

    for (let i = 0; i < 320; i++) sim.tick();

    svg
      .append("g")
      .selectAll("line")
      .data(simEdges)
      .join("line")
      .attr("stroke", chartTheme.axis)
      .attr("stroke-opacity", 0.35)
      .attr("stroke-width", (e) => ew(e.count))
      .attr("x1", (e) => (e.source as Node).x ?? 0)
      .attr("y1", (e) => (e.source as Node).y ?? 0)
      .attr("x2", (e) => (e.target as Node).x ?? 0)
      .attr("y2", (e) => (e.target as Node).y ?? 0)
      .append("title")
      .text(
        (e) =>
          `${(e.source as Node).id} ↔ ${(e.target as Node).id}\n${e.count} co-occurrences`,
      );

    const nodeSel = svg
      .append("g")
      .selectAll("g")
      .data(simNodes)
      .join("g")
      .attr("transform", (n) => `translate(${n.x ?? 0},${n.y ?? 0})`);

    nodeSel
      .append("circle")
      .attr("r", (n) => r(n.count))
      .attr("fill", (_n, i) => chartTheme.series[i % chartTheme.series.length])
      .attr("fill-opacity", 0.8)
      .attr("stroke", chartTheme.markerStroke)
      .attr("stroke-width", 1)
      .append("title")
      .text((n) => `${n.id}\n${n.count} listings`);

    nodeSel
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (n) => r(n.count) + 12)
      .attr("fill", chartTheme.label)
      .attr("font-size", 10)
      .style("paint-order", "stroke")
      .attr("stroke", "#0a0a0a")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.7)
      .text((n) => (r(n.count) > 8 ? n.id : ""));

    svg
      .append("text")
      .attr("x", 12)
      .attr("y", H - 10)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text(
        `${nodes.length} traits · ${edges.length} co-occurrence edges (≥${minPair})`,
      );
  }, [nodes, edges, minPair]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 540 }} />;
}
