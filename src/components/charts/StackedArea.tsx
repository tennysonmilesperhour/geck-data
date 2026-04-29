"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type StackedAreaInput = {
  first_seen_at: string | null;
  maturity: string | null;
};

const MATURITY_KEYS = ["Juvenile", "Subadult", "Adult", "Unknown"] as const;
type MaturityKey = (typeof MATURITY_KEYS)[number];

type WeekRow = { week: Date } & Record<MaturityKey, number>;

function bucketMaturity(raw: string | null): MaturityKey {
  if (!raw) return "Unknown";
  const v = raw.toLowerCase();
  if (v.startsWith("juv")) return "Juvenile";
  if (v.startsWith("sub")) return "Subadult";
  if (v.startsWith("adu")) return "Adult";
  return "Unknown";
}

export default function StackedArea({
  data,
  weeks = 26,
}: {
  data: StackedAreaInput[];
  weeks?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const rows = useMemo<WeekRow[]>(() => {
    const end = d3.timeWeek.floor(new Date());
    const start = d3.timeWeek.offset(end, -weeks);
    const weeksArr = d3.timeWeek.range(start, d3.timeWeek.offset(end, 1));
    const empty = (): WeekRow => ({
      week: new Date(0),
      Juvenile: 0,
      Subadult: 0,
      Adult: 0,
      Unknown: 0,
    });
    const byKey = new Map<number, WeekRow>();
    for (const w of weeksArr) {
      const r = empty();
      r.week = w;
      byKey.set(w.getTime(), r);
    }
    for (const d of data) {
      if (!d.first_seen_at) continue;
      const t = new Date(d.first_seen_at);
      if (Number.isNaN(t.getTime())) continue;
      if (t < start || t > end) continue;
      const key = d3.timeWeek.floor(t).getTime();
      const row = byKey.get(key);
      if (!row) continue;
      row[bucketMaturity(d.maturity)] += 1;
    }
    return weeksArr.map((w) => byKey.get(w.getTime())!);
  }, [data, weeks]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 360;
    const margin = { top: 16, right: 16, bottom: 36, left: 56 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const stack = d3
      .stack<WeekRow, MaturityKey>()
      .keys([...MATURITY_KEYS])
      .order(d3.stackOrderNone)
      .offset(d3.stackOffsetNone);
    const series = stack(rows);

    const x = d3
      .scaleTime()
      .domain(d3.extent(rows, (r) => r.week) as [Date, Date])
      .range([0, w]);
    const yMax = d3.max(series[series.length - 1], (p) => p[1]) ?? 1;
    const y = d3.scaleLinear().domain([0, yMax]).nice().range([h, 0]);

    const color = d3
      .scaleOrdinal<MaturityKey, string>()
      .domain([...MATURITY_KEYS])
      .range([
        chartTheme.series[0],
        chartTheme.series[1],
        chartTheme.series[2],
        chartTheme.series[4],
      ]);

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
      .text("new listings / week");

    const area = d3
      .area<d3.SeriesPoint<WeekRow>>()
      .x((p) => x(p.data.week))
      .y0((p) => y(p[0]))
      .y1((p) => y(p[1]))
      .curve(d3.curveMonotoneX);

    g.append("g")
      .selectAll("path")
      .data(series)
      .join("path")
      .attr("fill", (s) => color(s.key as MaturityKey))
      .attr("fill-opacity", 0.78)
      .attr("stroke", (s) => color(s.key as MaturityKey))
      .attr("stroke-width", 0.75)
      .attr("d", area)
      .append("title")
      .text((s) => {
        const total = d3.sum(rows, (r) => r[s.key as MaturityKey]);
        return `${s.key}: ${total} listings over ${weeks} weeks`;
      });

    const legend = g
      .append("g")
      .attr("transform", `translate(0,-4)`)
      .selectAll("g")
      .data(MATURITY_KEYS)
      .join("g")
      .attr("transform", (_d, i) => `translate(${i * 88},0)`);
    legend
      .append("rect")
      .attr("width", 10)
      .attr("height", 10)
      .attr("rx", 2)
      .attr("fill", (k) => color(k));
    legend
      .append("text")
      .attr("x", 14)
      .attr("y", 9)
      .attr("font-size", 11)
      .attr("fill", chartTheme.axisText)
      .text((k) => k);
  }, [rows, weeks]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 360 }} />;
}
