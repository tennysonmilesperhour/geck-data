"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type RidgeInput = {
  cached_traits: string | null;
  norm_traits: string | null;
  price_usd_equivalent: number | null;
  price: number | null;
};

type Row = { trait: string; prices: number[]; count: number };

function epanechnikov(bw: number) {
  return (v: number) => {
    const u = v / bw;
    return Math.abs(u) <= 1 ? (0.75 * (1 - u * u)) / bw : 0;
  };
}

function kde(
  kernel: (v: number) => number,
  xs: number[],
  sample: number[],
): Array<[number, number]> {
  return xs.map((x) => [x, d3.mean(sample, (s) => kernel(x - s)) ?? 0]);
}

export default function RidgePlot({
  data,
  topN = 10,
}: {
  data: RidgeInput[];
  topN?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const rows = useMemo<Row[]>(() => {
    const map = new Map<string, number[]>();
    for (const d of data) {
      const raw = (d.norm_traits || d.cached_traits || "").toLowerCase();
      if (!raw) continue;
      const tokens = raw.includes(",")
        ? raw.split(",").map((t) => t.trim())
        : raw.split(/\s+/).map((t) => t.trim());
      const price = d.price_usd_equivalent ?? d.price;
      if (price == null || price <= 0 || price >= 3500) continue;
      for (const t of tokens) {
        if (!t || t.length < 3) continue;
        const list = map.get(t) ?? [];
        list.push(price);
        map.set(t, list);
      }
    }
    const out: Row[] = [];
    for (const [trait, prices] of map.entries()) {
      if (prices.length < 10) continue;
      out.push({ trait, prices, count: prices.length });
    }
    return out.sort((a, b) => b.count - a.count).slice(0, topN);
  }, [data, topN]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = Math.max(400, rows.length * 54 + 60);
    const margin = { top: 16, right: 16, bottom: 36, left: 140 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const allPrices = rows.flatMap((r) => r.prices);
    const xMax = (d3.max(allPrices) ?? 1000) * 1.05;
    const x = d3.scaleLinear().domain([0, xMax]).nice().range([0, w]);
    const y = d3
      .scaleBand<string>()
      .domain(rows.map((r) => r.trait))
      .range([0, h])
      .padding(0);

    const steps = 180;
    const xs = d3.range(0, xMax, xMax / steps);
    const iqr = (d3.quantile(allPrices.slice().sort((a, b) => a - b), 0.75) ?? 500) -
      (d3.quantile(allPrices.slice().sort((a, b) => a - b), 0.25) ?? 100);
    const bw = Math.max(20, iqr / 3);
    const kern = epanechnikov(bw);

    const densities = rows.map((r) => kde(kern, xs, r.prices));
    const maxD = d3.max(densities.flat(), (d) => d[1]) ?? 1;
    const bandH = y.bandwidth();
    const ridgeH = bandH * 2.1;
    const yd = d3.scaleLinear().domain([0, maxD]).range([0, ridgeH]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(8)
          .tickFormat((v) => `$${d3.format(",")(v as number)}`),
      )
      .append("text")
      .attr("x", w)
      .attr("y", 32)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("price (linear)");

    rows.forEach((r, i) => {
      const color = chartTheme.series[i % chartTheme.series.length];
      const dens = densities[i];
      const row = g
        .append("g")
        .attr("transform", `translate(0, ${y(r.trait)! + bandH})`);
      const area = d3
        .area<[number, number]>()
        .x((d) => x(d[0]))
        .y0(0)
        .y1((d) => -yd(d[1]))
        .curve(d3.curveBasis);
      row
        .append("path")
        .attr("d", area(dens) ?? "")
        .attr("fill", color)
        .attr("fill-opacity", 0.55)
        .attr("stroke", color)
        .attr("stroke-width", 1);
      row
        .append("text")
        .attr("x", -8)
        .attr("y", 0)
        .attr("text-anchor", "end")
        .attr("dy", "0.35em")
        .attr("fill", chartTheme.axisText)
        .attr("font-size", 11)
        .text(`${r.trait} (${r.count})`);

      const med = d3.median(r.prices);
      if (med != null) {
        row
          .append("line")
          .attr("x1", x(med))
          .attr("x2", x(med))
          .attr("y1", 0)
          .attr("y2", -ridgeH * 0.35)
          .attr("stroke", chartTheme.secondary)
          .attr("stroke-width", 1.5)
          .attr("stroke-dasharray", "3 2");
      }
    });
  }, [rows]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 400 }} />;
}
