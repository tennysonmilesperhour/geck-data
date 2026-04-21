"use client";
// Top-N traits by listing count, with median price overlay.
// Bars = count (left axis). Dots = median price (right axis, log scale).
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type TraitInput = {
  cached_traits: string | null;
  norm_traits: string | null;
  price_usd_equivalent: number | null;
  price: number | null;
};

export default function TraitFrequencyAndPrice({
  data,
  topN = 25,
}: {
  data: TraitInput[];
  topN?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  // Aggregate: for each trait token, collect listings carrying it.
  const traitStats = useMemo(() => {
    const map = new Map<string, number[]>(); // trait -> prices[]
    for (const d of data) {
      const raw = (d.norm_traits || d.cached_traits || "").toLowerCase();
      if (!raw) continue;
      // Split on commas OR whitespace fallback.
      const tokens = raw.includes(",")
        ? raw.split(",").map((t) => t.trim())
        : raw.split(/\s+/).map((t) => t.trim());
      const price = d.price_usd_equivalent ?? d.price;
      for (const t of tokens) {
        if (!t || t.length < 3) continue;
        const list = map.get(t) ?? [];
        if (price != null && price > 0) list.push(price);
        map.set(t, list);
      }
    }
    return Array.from(map.entries())
      .map(([trait, prices]) => ({
        trait,
        count: prices.length,
        median: prices.length ? (d3.median(prices) ?? 0) : 0,
      }))
      .filter((d) => d.count >= 3)
      .sort((a, b) => b.count - a.count)
      .slice(0, topN);
  }, [data, topN]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || traitStats.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = Math.max(360, traitStats.length * 22 + 60);
    const margin = { top: 16, right: 60, bottom: 36, left: 160 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const y = d3
      .scaleBand()
      .domain(traitStats.map((d) => d.trait))
      .range([0, h])
      .padding(0.18);

    const xCount = d3
      .scaleLinear()
      .domain([0, d3.max(traitStats, (d) => d.count) ?? 1])
      .nice()
      .range([0, w]);

    const medExtent = d3.extent(
      traitStats.filter((d) => d.median > 0),
      (d) => d.median,
    ) as [number, number];
    const xPrice = d3
      .scaleLog()
      .domain([Math.max(10, medExtent[0] || 10), medExtent[1] || 1000])
      .range([0, w]);

    g.append("g").call(d3.axisLeft(y));

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(xCount).ticks(6))
      .append("text")
      .attr("x", w)
      .attr("y", -6)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("listings");

    // Bars
    g.append("g")
      .selectAll("rect")
      .data(traitStats)
      .join("rect")
      .attr("y", (d) => y(d.trait)!)
      .attr("x", 0)
      .attr("height", y.bandwidth())
      .attr("width", (d) => xCount(d.count))
      .attr("fill", chartTheme.primary)
      .attr("fill-opacity", 0.85);

    // Median price dots, on the same axis space (different scale)
    g.append("g")
      .selectAll("circle")
      .data(traitStats.filter((d) => d.median > 0))
      .join("circle")
      .attr("cy", (d) => y(d.trait)! + y.bandwidth() / 2)
      .attr("cx", (d) => xPrice(d.median))
      .attr("r", 5)
      .attr("fill", chartTheme.secondary)
      .attr("stroke", chartTheme.markerStroke)
      .attr("stroke-width", 1.5)
      .append("title")
      .text((d) => `${d.trait}: $${d3.format(",.0f")(d.median)} median`);

    // Legend
    const legend = g.append("g").attr("transform", `translate(${w - 180}, -4)`);
    legend
      .append("rect")
      .attr("width", 12)
      .attr("height", 12)
      .attr("fill", chartTheme.primary);
    legend
      .append("text")
      .attr("x", 18)
      .attr("y", 10)
      .attr("font-size", 11)
      .attr("fill", chartTheme.label)
      .text("listing count");
    legend
      .append("circle")
      .attr("cx", 110)
      .attr("cy", 6)
      .attr("r", 5)
      .attr("fill", chartTheme.secondary);
    legend
      .append("text")
      .attr("x", 120)
      .attr("y", 10)
      .attr("font-size", 11)
      .attr("fill", chartTheme.label)
      .text("median $ (log)");
  }, [traitStats]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 360 }} />;
}
