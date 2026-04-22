"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type PriceHeatmapInput = {
  first_seen_at: string | null;
};

const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function PriceHeatmap({ data }: { data: PriceHeatmapInput[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { grid, max } = useMemo(() => {
    const grid: number[][] = Array.from({ length: 7 }, () =>
      Array(24).fill(0),
    );
    for (const d of data) {
      if (!d.first_seen_at) continue;
      const t = new Date(d.first_seen_at);
      if (Number.isNaN(t.getTime())) continue;
      const dow = (t.getDay() + 6) % 7;
      const hour = t.getHours();
      grid[dow][hour]++;
    }
    let max = 0;
    for (const row of grid) for (const v of row) if (v > max) max = v;
    return { grid, max };
  }, [data]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const W = svgRef.current.clientWidth;
    const margin = { top: 28, right: 16, bottom: 28, left: 40 };
    const cellW = Math.max(
      12,
      Math.floor((W - margin.left - margin.right) / 24),
    );
    const cellH = Math.min(28, cellW);
    const H = margin.top + cellH * 7 + margin.bottom;

    svg.attr("viewBox", `0 0 ${W} ${H}`);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const color = d3
      .scaleSequential()
      .domain([0, Math.max(1, max)])
      .interpolator(d3.interpolateRgb("#1a1a1a", chartTheme.primary));

    DAY_LABELS.forEach((label, i) => {
      g.append("text")
        .attr("x", -8)
        .attr("y", i * cellH + cellH * 0.65)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("fill", chartTheme.axisText)
        .text(label);
    });

    [0, 3, 6, 9, 12, 15, 18, 21].forEach((h) => {
      g.append("text")
        .attr("x", h * cellW + cellW / 2)
        .attr("y", 7 * cellH + 14)
        .attr("text-anchor", "middle")
        .attr("font-size", 10)
        .attr("fill", chartTheme.axisText)
        .text(`${h}:00`);
    });

    for (let dow = 0; dow < 7; dow++) {
      for (let hr = 0; hr < 24; hr++) {
        const v = grid[dow][hr];
        g.append("rect")
          .attr("x", hr * cellW)
          .attr("y", dow * cellH)
          .attr("width", cellW - 2)
          .attr("height", cellH - 2)
          .attr("rx", 2)
          .attr("fill", v > 0 ? color(v) : "#141414")
          .append("title")
          .text(`${DAY_LABELS[dow]} ${hr}:00\n${v} new listings`);
      }
    }
  }, [grid, max]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 240 }} />;
}
