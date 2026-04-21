"use client";
// Histogram of days-to-sell for sold listings. Buckets of ~7 days, with a
// median line overlay to show the "typical" time on market.
import { useEffect, useRef } from "react";
import * as d3 from "d3";

export default function DaysToSellHistogram({ days }: { days: number[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || days.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 280;
    const margin = { top: 16, right: 16, bottom: 36, left: 44 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const clamped = days.filter((d) => d >= 0 && d <= 365);
    const x = d3
      .scaleLinear()
      .domain([0, d3.max(clamped) ?? 60])
      .nice()
      .range([0, w]);

    const bins = d3
      .bin<number, number>()
      .domain(x.domain() as [number, number])
      .thresholds(30)(clamped);

    const y = d3
      .scaleLinear()
      .domain([0, d3.max(bins, (b) => b.length) ?? 1])
      .nice()
      .range([h, 0]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(8).tickFormat((v) => `${v}d`));
    g.append("g").call(d3.axisLeft(y).ticks(6));

    g.append("g")
      .selectAll("rect")
      .data(bins)
      .join("rect")
      .attr("x", (b) => x(b.x0!) + 1)
      .attr("y", (b) => y(b.length))
      .attr("width", (b) => Math.max(0, x(b.x1!) - x(b.x0!) - 1))
      .attr("height", (b) => h - y(b.length))
      .attr("fill", "#1b5e20")
      .attr("opacity", 0.85);

    const median = d3.median(clamped);
    if (median != null) {
      g.append("line")
        .attr("x1", x(median))
        .attr("x2", x(median))
        .attr("y1", 0)
        .attr("y2", h)
        .attr("stroke", "#f57c00")
        .attr("stroke-width", 2)
        .attr("stroke-dasharray", "4 3");
      g.append("text")
        .attr("x", x(median) + 4)
        .attr("y", 12)
        .attr("font-size", 11)
        .attr("fill", "#f57c00")
        .text(`median ${Math.round(median)} days`);
    }
  }, [days]);

  return <svg ref={svgRef} className="h-72 w-full" />;
}
