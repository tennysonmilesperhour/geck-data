"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type CalendarInput = {
  first_seen_at: string | null;
};

type Cell = {
  day: Date;
  count: number;
  dow: number;
  week: number;
};

export default function CalendarHeatmap({
  data,
  weeks = 52,
}: {
  data: CalendarInput[];
  weeks?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const { cells, max, weekCount, monthMarkers } = useMemo(() => {
    const end = d3.timeDay.floor(new Date());
    const start = d3.timeMonday.floor(d3.timeDay.offset(end, -weeks * 7));
    const counts = new Map<number, number>();
    for (const d of data) {
      if (!d.first_seen_at) continue;
      const t = new Date(d.first_seen_at);
      if (Number.isNaN(t.getTime())) continue;
      if (t < start || t > end) continue;
      const k = d3.timeDay.floor(t).getTime();
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const cells: Cell[] = d3.timeDay
      .range(start, d3.timeDay.offset(end, 1))
      .map((day) => ({
        day,
        count: counts.get(day.getTime()) ?? 0,
        dow: (day.getDay() + 6) % 7,
        week: d3.timeMonday.count(start, day),
      }));
    const weekCount = d3.timeMonday.count(start, end) + 1;
    const max = d3.max(cells, (c) => c.count) ?? 1;
    const monthMarkers = d3.timeMonth
      .range(start, d3.timeMonth.offset(end, 1))
      .map((m) => ({
        month: m,
        week: d3.timeMonday.count(start, d3.timeMonday.floor(m)),
      }));
    return { cells, max, weekCount, monthMarkers };
  }, [data, weeks]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const W = svgRef.current.clientWidth;
    const margin = { top: 24, right: 16, bottom: 8, left: 32 };
    const cellW = Math.max(
      8,
      Math.floor((W - margin.left - margin.right) / weekCount),
    );
    const cellH = cellW;
    const H = margin.top + cellH * 7 + margin.bottom + 4;

    svg.attr("viewBox", `0 0 ${W} ${H}`);
    const g = svg
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const color = d3
      .scaleSequential()
      .domain([0, Math.max(1, max)])
      .interpolator(d3.interpolateRgb("#1a1a1a", chartTheme.primary));

    ["Mon", "Wed", "Fri"].forEach((label, i) => {
      g.append("text")
        .attr("x", -6)
        .attr("y", i * 2 * cellH + cellH * 0.7)
        .attr("text-anchor", "end")
        .attr("font-size", 9)
        .attr("fill", chartTheme.axisText)
        .text(label);
    });

    monthMarkers.forEach(({ month, week }) => {
      g.append("text")
        .attr("x", week * cellW)
        .attr("y", -8)
        .attr("font-size", 9)
        .attr("fill", chartTheme.axisText)
        .text(d3.timeFormat("%b")(month));
    });

    g.append("g")
      .selectAll("rect")
      .data(cells)
      .join("rect")
      .attr("x", (d) => d.week * cellW)
      .attr("y", (d) => d.dow * cellH)
      .attr("width", cellW - 2)
      .attr("height", cellH - 2)
      .attr("rx", 2)
      .attr("fill", (d) => (d.count > 0 ? color(d.count) : "#141414"))
      .append("title")
      .text(
        (d) =>
          `${d3.timeFormat("%a %b %-d, %Y")(d.day)}\n${d.count} new listings`,
      );
  }, [cells, max, weekCount, monthMarkers]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 160 }} />;
}
