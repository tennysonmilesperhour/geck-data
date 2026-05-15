"use client";
// Generic time-series line chart. Used for price history, seller snapshot
// trends, show mention cadence, etc. One or more numeric series over time.
import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type SeriesPoint = { t: Date; v: number };
export type Series = {
  name: string;
  color: string;
  points: SeriesPoint[];
};

// Annotated events overlay vertical markers on the chart so viewers
// can correlate a slope change with a known cause ("first scrape",
// "May 10 backfill", "trait promo"). Same pattern Bloomberg and
// Robinhood use for earnings markers on equity charts.
export type ChartEvent = {
  at: Date;
  label: string;
  tone?: "info" | "warn" | "positive";
};

const EVENT_TONE_COLOR: Record<NonNullable<ChartEvent["tone"]>, string> = {
  info: "#7ab1d1",      // ocean
  warn: "#cd6e3c",      // clay-400
  positive: "#7bbf83",  // sage
};

export default function TimeSeriesLine({
  series,
  events,
  height = 260,
  yFormat = (n) => d3.format(",.0f")(n),
  yLabel,
}: {
  series: Series[];
  events?: ChartEvent[];
  height?: number;
  yFormat?: (n: number) => string;
  yLabel?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const flat = series.flatMap((s) => s.points);
    if (flat.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = height;
    const margin = { top: 16, right: 80, bottom: 32, left: 52 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleTime()
      .domain(d3.extent(flat, (d) => d.t) as [Date, Date])
      .range([0, w]);
    const y = d3
      .scaleLinear()
      .domain([
        Math.min(0, d3.min(flat, (d) => d.v) ?? 0),
        d3.max(flat, (d) => d.v) ?? 1,
      ])
      .nice()
      .range([h, 0]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6));
    g.append("g")
      .call(d3.axisLeft(y).ticks(6).tickFormat((v) => yFormat(v as number)));

    if (yLabel) {
      g.append("text")
        .attr("x", -8)
        .attr("y", -6)
        .attr("text-anchor", "start")
        .attr("font-size", 11)
        .attr("fill", chartTheme.label)
        .text(yLabel);
    }

    const line = d3
      .line<SeriesPoint>()
      .x((d) => x(d.t))
      .y((d) => y(d.v))
      .curve(d3.curveMonotoneX);

    for (const s of series) {
      if (s.points.length === 0) continue;
      const sorted = [...s.points].sort((a, b) => a.t.getTime() - b.t.getTime());
      g.append("path")
        .datum(sorted)
        .attr("fill", "none")
        .attr("stroke", s.color)
        .attr("stroke-width", 2)
        .attr("d", line);
      g.append("g")
        .selectAll("circle")
        .data(sorted)
        .join("circle")
        .attr("cx", (d) => x(d.t))
        .attr("cy", (d) => y(d.v))
        .attr("r", 2.5)
        .attr("fill", s.color);
    }

    // Event annotations — vertical dotted markers + small dot at the
    // bottom axis with a tooltip surfacing the label on hover. Events
    // outside the chart's time domain are silently skipped so a
    // caller passing a generic event list doesn't push the marker off
    // the right edge.
    if (events && events.length > 0) {
      const [t0, t1] = x.domain() as [Date, Date];
      const inWindow = events.filter(
        (e) => e.at.getTime() >= t0.getTime() && e.at.getTime() <= t1.getTime(),
      );
      const eventLayer = g.append("g").attr("class", "events");
      for (const e of inWindow) {
        const xPos = x(e.at);
        const tone = e.tone ?? "info";
        const color = EVENT_TONE_COLOR[tone];
        eventLayer
          .append("line")
          .attr("x1", xPos)
          .attr("x2", xPos)
          .attr("y1", 0)
          .attr("y2", h)
          .attr("stroke", color)
          .attr("stroke-width", 1)
          .attr("stroke-dasharray", "3,3")
          .attr("opacity", 0.55);
        const marker = eventLayer
          .append("g")
          .attr("transform", `translate(${xPos}, ${h})`)
          .style("cursor", "default");
        marker.append("title").text(
          `${e.label} · ${d3.timeFormat("%b %-d, %Y")(e.at)}`,
        );
        marker
          .append("circle")
          .attr("r", 4)
          .attr("fill", color)
          .attr("stroke", chartTheme.markerStroke)
          .attr("stroke-width", 1.5);
      }
    }

    // Legend
    const legend = g
      .append("g")
      .attr("transform", `translate(${w + 12}, 0)`)
      .attr("font-size", 11);
    series.forEach((s, i) => {
      const row = legend.append("g").attr("transform", `translate(0, ${i * 16})`);
      row.append("rect").attr("width", 10).attr("height", 10).attr("fill", s.color);
      row
        .append("text")
        .attr("x", 14)
        .attr("y", 9)
        .attr("fill", chartTheme.label)
        .text(s.name);
    });
  }, [series, events, height, yFormat, yLabel]);

  return <svg ref={svgRef} className="w-full" style={{ height }} />;
}
