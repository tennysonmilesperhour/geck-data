"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type BoxPlotInput = {
  cached_traits: string | null;
  norm_traits: string | null;
  price_usd_equivalent: number | null;
  price: number | null;
};

type BoxStats = {
  trait: string;
  count: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
};

export default function BoxPlot({
  data,
  topN = 15,
}: {
  data: BoxPlotInput[];
  topN?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const stats = useMemo<BoxStats[]>(() => {
    const map = new Map<string, number[]>();
    for (const d of data) {
      const raw = (d.norm_traits || d.cached_traits || "").toLowerCase();
      if (!raw) continue;
      const tokens = raw.includes(",")
        ? raw.split(",").map((t) => t.trim())
        : raw.split(/\s+/).map((t) => t.trim());
      const price = d.price_usd_equivalent ?? d.price;
      if (price == null || price <= 0 || price >= 10000) continue;
      for (const t of tokens) {
        if (!t || t.length < 3) continue;
        const list = map.get(t) ?? [];
        list.push(price);
        map.set(t, list);
      }
    }
    const rows: BoxStats[] = [];
    for (const [trait, prices] of map.entries()) {
      if (prices.length < 5) continue;
      const sorted = prices.slice().sort((a, b) => a - b);
      rows.push({
        trait,
        count: sorted.length,
        min: sorted[0],
        q1: d3.quantile(sorted, 0.25) ?? sorted[0],
        median: d3.quantile(sorted, 0.5) ?? sorted[0],
        q3: d3.quantile(sorted, 0.75) ?? sorted[0],
        max: sorted[sorted.length - 1],
      });
    }
    return rows.sort((a, b) => b.count - a.count).slice(0, topN);
  }, [data, topN]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || stats.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = Math.max(360, stats.length * 26 + 60);
    const margin = { top: 16, right: 56, bottom: 36, left: 160 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const y = d3
      .scaleBand<string>()
      .domain(stats.map((d) => d.trait))
      .range([0, h])
      .padding(0.25);

    const xMin = d3.min(stats, (d) => d.min) ?? 1;
    const xMax = d3.max(stats, (d) => d.max) ?? 10;
    const x = d3
      .scaleLog()
      .domain([Math.max(1, xMin * 0.9), xMax * 1.1])
      .range([0, w]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((v) => `$${d3.format(",")(v as number)}`),
      )
      .append("text")
      .attr("x", w)
      .attr("y", 32)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("price (log)");

    g.append("g").call(d3.axisLeft(y));

    const boxH = y.bandwidth();

    const box = g.append("g").selectAll("g").data(stats).join("g");

    box
      .append("line")
      .attr("x1", (d) => x(d.min))
      .attr("x2", (d) => x(d.max))
      .attr("y1", (d) => y(d.trait)! + boxH / 2)
      .attr("y2", (d) => y(d.trait)! + boxH / 2)
      .attr("stroke", chartTheme.axis);

    box
      .append("line")
      .attr("x1", (d) => x(d.min))
      .attr("x2", (d) => x(d.min))
      .attr("y1", (d) => y(d.trait)! + boxH * 0.3)
      .attr("y2", (d) => y(d.trait)! + boxH * 0.7)
      .attr("stroke", chartTheme.axis);
    box
      .append("line")
      .attr("x1", (d) => x(d.max))
      .attr("x2", (d) => x(d.max))
      .attr("y1", (d) => y(d.trait)! + boxH * 0.3)
      .attr("y2", (d) => y(d.trait)! + boxH * 0.7)
      .attr("stroke", chartTheme.axis);

    box
      .append("rect")
      .attr("x", (d) => x(d.q1))
      .attr("y", (d) => y(d.trait)!)
      .attr("width", (d) => Math.max(1, x(d.q3) - x(d.q1)))
      .attr("height", boxH)
      .attr("fill", chartTheme.primary)
      .attr("fill-opacity", 0.6)
      .attr("stroke", chartTheme.primary)
      .append("title")
      .text(
        (d) =>
          `${d.trait} (n=${d.count})\nmin $${d3.format(",.0f")(d.min)} · Q1 $${d3.format(",.0f")(d.q1)} · median $${d3.format(",.0f")(d.median)} · Q3 $${d3.format(",.0f")(d.q3)} · max $${d3.format(",.0f")(d.max)}`,
      );

    box
      .append("line")
      .attr("x1", (d) => x(d.median))
      .attr("x2", (d) => x(d.median))
      .attr("y1", (d) => y(d.trait)!)
      .attr("y2", (d) => y(d.trait)! + boxH)
      .attr("stroke", chartTheme.secondary)
      .attr("stroke-width", 2);

    box
      .append("text")
      .attr("x", w + 4)
      .attr("y", (d) => y(d.trait)! + boxH / 2 + 4)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text((d) => `n=${d.count}`);
  }, [stats]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 360 }} />;
}
