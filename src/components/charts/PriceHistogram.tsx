"use client";
// Histogram of listing prices with optional maturity / sex filters.
// Pure D3 — uses a useRef + useEffect "render-on-data-change" pattern.
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type Listing = {
  id: string;
  price: number | null;
  price_usd_equivalent: number | null;
  maturity: string | null;
  sex: string | null;
};

const MATURITIES = ["All", "Juvenile", "Subadult", "Adult"] as const;
const SEXES = ["All", "male", "female", "unknown"] as const;

export default function PriceHistogram({ data }: { data: Listing[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [maturity, setMaturity] = useState<(typeof MATURITIES)[number]>("All");
  const [sex, setSex] = useState<(typeof SEXES)[number]>("All");

  // Filter + clamp prices to a sensible window (drop outliers above $5k for the histogram).
  const prices = useMemo(() => {
    return data
      .filter((d) => maturity === "All" || d.maturity === maturity)
      .filter((d) => sex === "All" || d.sex === sex)
      .map((d) => d.price_usd_equivalent ?? d.price)
      .filter((p): p is number => p != null && p > 0 && p < 5000);
  }, [data, maturity, sex]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || prices.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 320;
    const margin = { top: 16, right: 16, bottom: 36, left: 44 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLinear()
      .domain([0, d3.max(prices) ?? 1000])
      .nice()
      .range([0, w]);

    const bins = d3
      .bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(40)(prices);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (b) => b.length) ?? 1])
      .nice()
      .range([h, 0]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(8)
          .tickFormat((v) => `$${d3.format(",")(v as number)}`),
      );

    g.append("g").call(d3.axisLeft(y).ticks(6));

    g.append("g")
      .selectAll("rect")
      .data(bins)
      .join("rect")
      .attr("x", (b) => x(b.x0!) + 1)
      .attr("y", (b) => y(b.length))
      .attr("width", (b) => Math.max(0, x(b.x1!) - x(b.x0!) - 1))
      .attr("height", (b) => h - y(b.length))
      .attr("fill", chartTheme.primary)
      .attr("opacity", 0.85);

    // Median line
    const median = d3.median(prices);
    if (median != null) {
      g.append("line")
        .attr("x1", x(median))
        .attr("x2", x(median))
        .attr("y1", 0)
        .attr("y2", h)
        .attr("stroke", chartTheme.secondary)
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4 3");
      g.append("text")
        .attr("x", x(median) + 4)
        .attr("y", 12)
        .attr("font-size", 11)
        .attr("fill", chartTheme.secondary)
        .text(`median $${d3.format(",.0f")(median)}`);
    }
  }, [prices]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
        <span className="font-mono text-[10px] uppercase tracking-wider text-ink-400">Maturity</span>
        {MATURITIES.map((m) => (
          <button
            key={m}
            onClick={() => setMaturity(m)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              maturity === m
                ? "border-claude bg-claude/15 text-claude-glow"
                : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600 hover:text-ink-100"
            }`}
          >
            {m}
          </button>
        ))}
        <span className="ml-4 font-mono text-[10px] uppercase tracking-wider text-ink-400">Sex</span>
        {SEXES.map((s) => (
          <button
            key={s}
            onClick={() => setSex(s)}
            className={`rounded-full border px-2.5 py-1 text-xs transition ${
              sex === s
                ? "border-claude bg-claude/15 text-claude-glow"
                : "border-ink-700 bg-ink-850 text-ink-300 hover:border-ink-600 hover:text-ink-100"
            }`}
          >
            {s}
          </button>
        ))}
        <span className="ml-auto font-mono text-[11px] text-ink-500">{prices.length} listings</span>
      </div>
      <svg ref={svgRef} className="h-80 w-full" />
    </div>
  );
}
