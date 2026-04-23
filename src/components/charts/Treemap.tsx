"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type TreemapSeller = {
  seller_id: string;
  seller_name: string | null;
  total_listings: number | null;
};

type Leaf = { name: string; value: number };

export default function Treemap({
  data,
  topN = 30,
}: {
  data: TreemapSeller[];
  topN?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const leaves = useMemo<Leaf[]>(() => {
    const rows = data
      .filter((d) => (d.total_listings ?? 0) > 0)
      .sort((a, b) => (b.total_listings ?? 0) - (a.total_listings ?? 0));
    const top = rows.slice(0, topN);
    const tail = rows.slice(topN);
    const tailTotal = tail.reduce((acc, d) => acc + (d.total_listings ?? 0), 0);
    const entries: Leaf[] = top.map((d) => ({
      name: d.seller_name ?? d.seller_id,
      value: d.total_listings ?? 0,
    }));
    if (tailTotal > 0)
      entries.push({ name: `Other (${tail.length})`, value: tailTotal });
    return entries;
  }, [data, topN]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || leaves.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 480;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    type Node = { name: string; value?: number; children?: Leaf[] };
    const root = d3
      .hierarchy<Node>({ name: "market", children: leaves })
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const laidOut = d3.treemap<Node>().size([W, H]).padding(2).round(true)(root);

    const total = laidOut.value ?? 1;

    const nodes = svg
      .append("g")
      .selectAll("g")
      .data(root.leaves())
      .join("g")
      .attr("transform", (d) => `translate(${d.x0},${d.y0})`);

    nodes
      .append("rect")
      .attr("width", (d) => d.x1 - d.x0)
      .attr("height", (d) => d.y1 - d.y0)
      .attr("fill", (_d, i) => chartTheme.series[i % chartTheme.series.length])
      .attr("fill-opacity", 0.78)
      .attr("stroke", chartTheme.tooltipBorder)
      .append("title")
      .text(
        (d) =>
          `${d.data.name}\n${d.value} listings · ${(((d.value ?? 0) / total) * 100).toFixed(1)}%`,
      );

    nodes
      .append("text")
      .attr("x", 6)
      .attr("y", 14)
      .attr("fill", "#f8f5ed")
      .attr("font-size", 11)
      .attr("font-weight", 600)
      .style("paint-order", "stroke")
      .attr("stroke", "#0a0a0a")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6)
      .text((d) => {
        const wpx = d.x1 - d.x0;
        const label = d.data.name;
        return wpx > 140 ? label : label.length > 14 ? label.slice(0, 14) + "…" : label;
      })
      .attr("visibility", (d) =>
        d.x1 - d.x0 < 40 || d.y1 - d.y0 < 18 ? "hidden" : "visible",
      );

    nodes
      .append("text")
      .attr("x", 6)
      .attr("y", 28)
      .attr("fill", "#f8f5ed")
      .attr("fill-opacity", 0.85)
      .attr("font-size", 10)
      .attr("font-family", "monospace")
      .style("paint-order", "stroke")
      .attr("stroke", "#0a0a0a")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6)
      .text((d) => `${d.value}`)
      .attr("visibility", (d) =>
        d.x1 - d.x0 < 60 || d.y1 - d.y0 < 32 ? "hidden" : "visible",
      );
  }, [leaves]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 480 }} />;
}
