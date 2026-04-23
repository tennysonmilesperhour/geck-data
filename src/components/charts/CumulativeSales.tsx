"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type SoldEvent = {
  observed_at: string;
};

type Point = { week: Date; cumulative: number; weekly: number };

export default function CumulativeSales({
  data,
  weeks = 26,
}: {
  data: SoldEvent[];
  weeks?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const points = useMemo<Point[]>(() => {
    const end = d3.timeWeek.floor(new Date());
    const start = d3.timeWeek.offset(end, -weeks);
    const counts = new Map<number, number>();
    for (const d of data) {
      if (!d.observed_at) continue;
      const t = new Date(d.observed_at);
      if (Number.isNaN(t.getTime())) continue;
      if (t < start || t > end) continue;
      const wk = d3.timeWeek.floor(t).getTime();
      counts.set(wk, (counts.get(wk) ?? 0) + 1);
    }
    const weeksArr = d3.timeWeek.range(start, d3.timeWeek.offset(end, 1));
    let acc = 0;
    return weeksArr.map((w) => {
      const weekly = counts.get(w.getTime()) ?? 0;
      acc += weekly;
      return { week: w, cumulative: acc, weekly };
    });
  }, [data, weeks]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || points.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 360;
    const margin = { top: 16, right: 16, bottom: 36, left: 56 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleTime()
      .domain(d3.extent(points, (p) => p.week) as [Date, Date])
      .range([0, w]);
    const y = d3
      .scaleLinear()
      .domain([0, d3.max(points, (p) => p.cumulative) ?? 1])
      .nice()
      .range([h, 0]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6))
      .append("text")
      .attr("x", w)
      .attr("y", 32)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text(`last ${weeks} weeks`);

    g.append("g")
      .call(d3.axisLeft(y))
      .append("text")
      .attr("x", 4)
      .attr("y", -6)
      .attr("fill", chartTheme.label)
      .text("cumulative sold");

    const area = d3
      .area<Point>()
      .x((p) => x(p.week))
      .y0(h)
      .y1((p) => y(p.cumulative))
      .curve(d3.curveMonotoneX);

    g.append("path")
      .datum(points)
      .attr("d", area)
      .attr("fill", chartTheme.primary)
      .attr("fill-opacity", 0.55);

    g.append("path")
      .datum(points)
      .attr(
        "d",
        d3
          .line<Point>()
          .x((p) => x(p.week))
          .y((p) => y(p.cumulative))
          .curve(d3.curveMonotoneX),
      )
      .attr("fill", "none")
      .attr("stroke", chartTheme.primary)
      .attr("stroke-width", 2);

    g.append("g")
      .selectAll("circle")
      .data(points)
      .join("circle")
      .attr("cx", (p) => x(p.week))
      .attr("cy", (p) => y(p.cumulative))
      .attr("r", 2.5)
      .attr("fill", chartTheme.secondary)
      .append("title")
      .text(
        (p) =>
          `Week of ${d3.timeFormat("%b %-d")(p.week)}\n+${p.weekly} sold this week\n${p.cumulative} cumulative`,
      );
  }, [points, weeks]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 360 }} />;
}
