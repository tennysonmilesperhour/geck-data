"use client";
// Seller leaderboard scatter. Each dot is a seller; x = feedback count
// (log), y = average listing price (log), size = current inventory.
//
// Choices made for readability (vs the earlier version):
//
// * y is now log-scale. The price distribution is heavy-tailed (a
//   handful of premium sellers at $5k+ used to flatten the bottom
//   80% into an unreadable smear). Log spreads the cluster out so
//   the differences within the $50–$1,500 mass become visible.
// * One accent color across all dots. Membership tier is irrelevant
//   to the question this chart actually answers ("scale of reach vs
//   scale of price") and the previous tier palette read as decorative
//   noise. Tier info is still in the hover.
// * Median price horizontal reference line so every viewer has an
//   anchor for "is this seller above or below market?".
// * Top sellers by inventory are labelled inline so the named points
//   carry the chart instead of an undifferentiated cloud.
// * Lower fill opacity + a faint stroke so overlapping dots show
//   their density.

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type Seller = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  feedback_count: number | null;
  seller_rating_score: number | null;
  total_listings: number | null;
  avg_price: number | null;
  five_star_rating: number | null;
};

export default function SellerLeaderboardScatter({ data }: { data: Seller[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const rows = data.filter(
      (d) =>
        (d.feedback_count ?? d.seller_rating_score ?? 0) > 0 &&
        (d.avg_price ?? 0) > 0 &&
        (d.total_listings ?? 0) > 0,
    );
    if (rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 440;
    const margin = { top: 18, right: 24, bottom: 44, left: 64 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const root = svg.attr("viewBox", `0 0 ${W} ${H}`);
    const g = root
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales --------------------------------------------------------------

    const feedbackOf = (d: Seller): number =>
      Math.max(1, d.feedback_count ?? d.seller_rating_score ?? 1);

    const x = d3
      .scaleLog()
      .domain([
        Math.max(1, d3.min(rows, feedbackOf) ?? 1),
        d3.max(rows, feedbackOf) ?? 10,
      ])
      .range([0, w]);

    // Log y. Floor at $25 so axis ticks aren't dominated by sub-$10
    // outliers; clip top at one nice round magnitude above the data.
    const yMin = Math.max(25, d3.min(rows, (d) => d.avg_price!) ?? 25);
    const yMax = d3.max(rows, (d) => d.avg_price!) ?? 1000;
    const y = d3
      .scaleLog()
      .domain([yMin, yMax * 1.15])
      .range([h, 0]);

    const r = d3
      .scaleSqrt()
      .domain([1, d3.max(rows, (d) => d.total_listings!) ?? 10])
      .range([2.5, 16]);

    // Median reference line ----------------------------------------------

    const median =
      d3.quantile(
        rows.map((d) => d.avg_price!).sort((a, b) => a - b),
        0.5,
      ) ?? 0;

    // Gridlines ----------------------------------------------------------

    const gridY = g.append("g").attr("class", "gridY");
    gridY
      .selectAll("line")
      .data(y.ticks(6))
      .join("line")
      .attr("x1", 0)
      .attr("x2", w)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", chartTheme.grid)
      .attr("stroke-opacity", 0.45)
      .attr("stroke-dasharray", "1,3");

    const gridX = g.append("g").attr("class", "gridX");
    gridX
      .selectAll("line")
      .data(x.ticks(6))
      .join("line")
      .attr("y1", 0)
      .attr("y2", h)
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("stroke", chartTheme.grid)
      .attr("stroke-opacity", 0.35)
      .attr("stroke-dasharray", "1,3");

    // Axes ---------------------------------------------------------------

    const xAxis = d3
      .axisBottom(x)
      .ticks(6, d3.format(","))
      .tickSizeOuter(0);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(xAxis)
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", w)
      .attr("y", 34)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("feedback count (log)");

    const yAxis = d3
      .axisLeft(y)
      .ticks(6, (v: d3.NumberValue) => `$${d3.format(",")(v as number)}`)
      .tickSizeOuter(0);

    g.append("g")
      .call(yAxis)
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", 0)
      .attr("y", -8)
      .attr("fill", chartTheme.label)
      .text("avg listing price (log)");

    // Median reference line ----------------------------------------------

    if (median > 0 && median >= yMin && median <= yMax) {
      const medLine = g.append("g");
      medLine
        .append("line")
        .attr("x1", 0)
        .attr("x2", w)
        .attr("y1", y(median))
        .attr("y2", y(median))
        .attr("stroke", chartTheme.warn)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.65);
      medLine
        .append("text")
        .attr("x", w - 4)
        .attr("y", y(median) - 6)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono)")
        .attr("fill", chartTheme.warn)
        .text(`market median $${d3.format(",.0f")(median)}`);
    }

    // Dots ---------------------------------------------------------------

    const accent = chartTheme.primary;
    const dotG = g.append("g").attr("class", "dots");

    dotG
      .selectAll("circle")
      .data(rows)
      .join("circle")
      .attr("cx", (d) => x(feedbackOf(d)))
      .attr("cy", (d) => y(d.avg_price!))
      .attr("r", (d) => r(d.total_listings!))
      .attr("fill", accent)
      .attr("fill-opacity", 0.4)
      .attr("stroke", accent)
      .attr("stroke-opacity", 0.65)
      .attr("stroke-width", 0.8)
      .append("title")
      .text(
        (d) =>
          `${d.seller_name ?? d.seller_id}\n${d.seller_location ?? ""}\n` +
          `feedback: ${d.feedback_count ?? d.seller_rating_score} · ` +
          `listings: ${d.total_listings} · avg $${d3.format(",.0f")(d.avg_price!)}\n` +
          `membership: ${d.membership ?? "—"}`,
      );

    // Label the top sellers by current inventory so the chart reads
    // as "named points + supporting cloud" rather than an
    // undifferentiated swarm. Skip if the chart is narrow.
    if (w > 360) {
      const labelled = rows
        .slice()
        .sort((a, b) => (b.total_listings ?? 0) - (a.total_listings ?? 0))
        .slice(0, 5);

      const labelG = g.append("g").attr("class", "labels");
      labelG
        .selectAll("text")
        .data(labelled)
        .join("text")
        .attr("x", (d) => x(feedbackOf(d)) + r(d.total_listings!) + 4)
        .attr("y", (d) => y(d.avg_price!) + 3)
        .attr("font-size", 10)
        .attr("font-family", "var(--font-sans)")
        .attr("fill", chartTheme.label)
        .text((d) => (d.seller_name ?? d.seller_id).slice(0, 24));
    }

    // Legend keeps size-encoding only. Tier color was dropping out;
    // the size scale is the actual data layer here.
    const sizeLegend = g
      .append("g")
      .attr("transform", `translate(${w - 124}, 4)`);
    sizeLegend
      .append("text")
      .attr("x", 0)
      .attr("y", 10)
      .attr("font-size", 10)
      .attr("font-family", "var(--font-mono)")
      .attr("fill", chartTheme.label)
      .text("dot size = listings");
  }, [data]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 440 }} />;
}
