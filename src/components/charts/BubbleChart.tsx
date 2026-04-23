"use client";
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type BubbleSeller = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  feedback_count: number | null;
  total_listings: number | null;
  avg_price: number | null;
};

const MEMBERSHIP_COLOR: Record<string, string> = {
  Basic: "#6b6b6b",
  Premium: "#60a5fa",
  Pro: "#d97757",
  Elite: "#f87171",
};

export default function BubbleChart({ data }: { data: BubbleSeller[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const rows = data.filter(
      (d) => (d.total_listings ?? 0) > 0 && (d.avg_price ?? 0) > 0,
    );
    if (rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 440;
    const margin = { top: 16, right: 16, bottom: 44, left: 64 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = d3.max(rows, (d) => d.total_listings!) ?? 10;
    const x = d3.scaleLinear().domain([0, xMax * 1.05]).nice().range([0, w]);
    const y = d3
      .scaleLinear()
      .domain([0, (d3.max(rows, (d) => d.avg_price!) ?? 500) * 1.1])
      .nice()
      .range([h, 0]);
    const r = d3
      .scaleSqrt()
      .domain([0, d3.max(rows, (d) => d.feedback_count ?? 0) ?? 10])
      .range([3, 24]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(8))
      .append("text")
      .attr("x", w)
      .attr("y", 32)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("live listings");

    g.append("g")
      .call(d3.axisLeft(y).tickFormat((v) => `$${d3.format(",")(v as number)}`))
      .append("text")
      .attr("x", 4)
      .attr("y", -6)
      .attr("fill", chartTheme.label)
      .text("avg listing price");

    g.append("g")
      .selectAll("circle")
      .data(rows)
      .join("circle")
      .attr("cx", (d) => x(d.total_listings!))
      .attr("cy", (d) => y(d.avg_price!))
      .attr("r", (d) => r(d.feedback_count ?? 0))
      .attr("fill", (d) => MEMBERSHIP_COLOR[d.membership ?? ""] ?? "#6b6b6b")
      .attr("fill-opacity", 0.65)
      .attr("stroke", chartTheme.markerStroke)
      .attr("stroke-width", 1)
      .append("title")
      .text(
        (d) =>
          `${d.seller_name ?? d.seller_id}\n${d.seller_location ?? ""}\n` +
          `listings: ${d.total_listings} · avg $${d3.format(",.0f")(d.avg_price!)}\n` +
          `feedback (≈ sold proxy): ${d.feedback_count ?? 0}\n` +
          `membership: ${d.membership ?? "—"}`,
      );

    const legend = g.append("g").attr("transform", `translate(${w - 160}, 8)`);
    Object.entries(MEMBERSHIP_COLOR).forEach(([label, color], i) => {
      const gg = legend.append("g").attr("transform", `translate(0, ${i * 16})`);
      gg.append("circle").attr("r", 5).attr("fill", color).attr("cx", 6).attr("cy", 6);
      gg
        .append("text")
        .attr("x", 16)
        .attr("y", 10)
        .attr("font-size", 11)
        .attr("fill", chartTheme.label)
        .text(label);
    });

    g.append("text")
      .attr("x", w - 160)
      .attr("y", 82)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text("bubble size = feedback count (≈ sold)");
  }, [data]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 440 }} />;
}
