"use client";
// Per-seller bubble plot. x = live listings, y = avg listing price,
// size = feedback count (a sold-volume proxy).
//
// Same readability fixes as SellerLeaderboardScatter: log-scale on
// both axes so the heavy-tail cluster opens up, a market-median
// reference line, the top sellers labelled inline, lower fill
// opacity so overlapping bubbles read as density rather than
// opaque clumps. Single accent color; the previous tier palette
// didn't carry any insight that wasn't already in the size or
// position.

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
    const margin = { top: 18, right: 24, bottom: 44, left: 64 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales (both log). Floor each to a sensible minimum so axis
    // ticks don't compress against the origin.
    const xMin = Math.max(1, d3.min(rows, (d) => d.total_listings!) ?? 1);
    const xMax = d3.max(rows, (d) => d.total_listings!) ?? 10;
    const x = d3.scaleLog().domain([xMin, xMax * 1.1]).range([0, w]);

    const yMin = Math.max(25, d3.min(rows, (d) => d.avg_price!) ?? 25);
    const yMax = d3.max(rows, (d) => d.avg_price!) ?? 1000;
    const y = d3.scaleLog().domain([yMin, yMax * 1.15]).range([h, 0]);

    const r = d3
      .scaleSqrt()
      .domain([0, d3.max(rows, (d) => d.feedback_count ?? 0) ?? 10])
      .range([2.5, 18]);

    // Gridlines
    g.append("g")
      .selectAll("line")
      .data(y.ticks(6))
      .join("line")
      .attr("x1", 0)
      .attr("x2", w)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", chartTheme.grid)
      .attr("stroke-opacity", 0.45)
      .attr("stroke-dasharray", "1,3");

    g.append("g")
      .selectAll("line")
      .data(x.ticks(6))
      .join("line")
      .attr("y1", 0)
      .attr("y2", h)
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("stroke", chartTheme.grid)
      .attr("stroke-opacity", 0.35)
      .attr("stroke-dasharray", "1,3");

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6, d3.format(",")).tickSizeOuter(0))
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", w)
      .attr("y", 34)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("live listings (log)");

    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(6, (v: d3.NumberValue) => `$${d3.format(",")(v as number)}`)
          .tickSizeOuter(0),
      )
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", 0)
      .attr("y", -8)
      .attr("fill", chartTheme.label)
      .text("avg listing price (log)");

    // Median reference line
    const median =
      d3.quantile(
        rows.map((d) => d.avg_price!).sort((a, b) => a - b),
        0.5,
      ) ?? 0;
    if (median > 0 && median >= yMin && median <= yMax) {
      g.append("line")
        .attr("x1", 0)
        .attr("x2", w)
        .attr("y1", y(median))
        .attr("y2", y(median))
        .attr("stroke", chartTheme.warn)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.65);
      g.append("text")
        .attr("x", w - 4)
        .attr("y", y(median) - 6)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono)")
        .attr("fill", chartTheme.warn)
        .text(`market median $${d3.format(",.0f")(median)}`);
    }

    const accent = chartTheme.primary;
    g.append("g")
      .selectAll("circle")
      .data(rows)
      .join("circle")
      .attr("cx", (d) => x(Math.max(1, d.total_listings!)))
      .attr("cy", (d) => y(d.avg_price!))
      .attr("r", (d) => r(d.feedback_count ?? 0))
      .attr("fill", accent)
      .attr("fill-opacity", 0.4)
      .attr("stroke", accent)
      .attr("stroke-opacity", 0.65)
      .attr("stroke-width", 0.8)
      .append("title")
      .text(
        (d) =>
          `${d.seller_name ?? d.seller_id}\n${d.seller_location ?? ""}\n` +
          `listings: ${d.total_listings} · avg $${d3.format(",.0f")(d.avg_price!)}\n` +
          `feedback (≈ sold proxy): ${d.feedback_count ?? 0}\n` +
          `membership: ${d.membership ?? "—"}`,
      );

    if (w > 360) {
      const labelled = rows
        .slice()
        .sort((a, b) => (b.feedback_count ?? 0) - (a.feedback_count ?? 0))
        .slice(0, 5);
      g.append("g")
        .selectAll("text")
        .data(labelled)
        .join("text")
        .attr("x", (d) => x(Math.max(1, d.total_listings!)) + r(d.feedback_count ?? 0) + 4)
        .attr("y", (d) => y(d.avg_price!) + 3)
        .attr("font-size", 10)
        .attr("font-family", "var(--font-sans)")
        .attr("fill", chartTheme.label)
        .text((d) => (d.seller_name ?? d.seller_id).slice(0, 24));
    }

    g.append("text")
      .attr("x", w - 4)
      .attr("y", h - 6)
      .attr("text-anchor", "end")
      .attr("font-size", 10)
      .attr("font-family", "var(--font-mono)")
      .attr("fill", chartTheme.axisText)
      .text("bubble size = feedback (≈ sold proxy)");
  }, [data]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 440 }} />;
}
