"use client";
// Per-seller density plot. The old all-dots scatter was unreadable
// because 600+ sellers with 1-3 listings stacked into vertical walls
// at x=1, x=2, x=3 and the middle was a fuzzy overlap blob.
//
// What we do now, top to bottom:
//
//   1. Filter to "in-business" sellers (>= 2 live listings) so the
//      noise floor of single-animal hobbyists doesn't dominate the
//      view. The count of filtered sellers is reported below the
//      chart so the trim is honest.
//   2. Bin every remaining seller into a log-log grid of cells. The
//      cells are coloured by density (sellers-per-cell) — that's the
//      actual "where does the market live" signal.
//   3. Overlay the top sellers by feedback as named dots on top of
//      the density layer, so the headline points carry the chart.
//   4. Keep the market median price as a dashed reference line.
//
// Result: the eye reads density first, named outliers second. No more
// vertical walls at integer x positions and no more opaque green blob
// in the middle.

import { useEffect, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type BubbleSeller = {
  seller_id: string;
  seller_name: string | null;
  seller_location: string | null;
  membership: string | null;
  feedback_count: number | null;
  total_listings: number | null;
  avg_price: number | null;
};

const BIN_X = 14;
const BIN_Y = 10;
const MIN_LISTINGS = 2;

export default function BubbleChart({ data }: { data: BubbleSeller[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    const universe = data.filter(
      (d) => (d.total_listings ?? 0) > 0 && (d.avg_price ?? 0) > 0,
    );
    const rows = universe.filter((d) => (d.total_listings ?? 0) >= MIN_LISTINGS);
    const filteredOut = universe.length - rows.length;
    if (rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 440;
    const margin = { top: 18, right: 24, bottom: 52, left: 64 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    // Scales (log on both axes).
    const xMin = Math.max(MIN_LISTINGS, d3.min(rows, (d) => d.total_listings!) ?? MIN_LISTINGS);
    const xMax = d3.max(rows, (d) => d.total_listings!) ?? 10;
    const x = d3.scaleLog().domain([xMin, xMax * 1.1]).range([0, w]);

    const yMin = Math.max(25, d3.min(rows, (d) => d.avg_price!) ?? 25);
    const yMax = d3.max(rows, (d) => d.avg_price!) ?? 1000;
    const y = d3.scaleLog().domain([yMin, yMax * 1.15]).range([h, 0]);

    // Compute log-space bin index for each row, then aggregate.
    type Cell = { ix: number; iy: number; count: number; sample: BubbleSeller };
    const logXmin = Math.log(x.domain()[0]!);
    const logXmax = Math.log(x.domain()[1]!);
    const logYmin = Math.log(y.domain()[0]!);
    const logYmax = Math.log(y.domain()[1]!);
    const cellMap = new Map<string, Cell>();
    for (const r of rows) {
      const lx = Math.log(Math.max(MIN_LISTINGS, r.total_listings!));
      const ly = Math.log(Math.max(yMin, r.avg_price!));
      const ix = Math.min(
        BIN_X - 1,
        Math.max(0, Math.floor(((lx - logXmin) / (logXmax - logXmin)) * BIN_X)),
      );
      const iy = Math.min(
        BIN_Y - 1,
        Math.max(0, Math.floor(((ly - logYmin) / (logYmax - logYmin)) * BIN_Y)),
      );
      const key = `${ix}|${iy}`;
      const cur = cellMap.get(key);
      if (cur) cur.count += 1;
      else cellMap.set(key, { ix, iy, count: 1, sample: r });
    }
    const cells = Array.from(cellMap.values());
    const cellMax = Math.max(1, d3.max(cells, (c) => c.count) ?? 1);
    const cellW = w / BIN_X;
    const cellH = h / BIN_Y;

    // Density layer first (background).
    const accent = chartTheme.primary;
    const density = g.append("g").attr("class", "density");
    density
      .selectAll("rect")
      .data(cells)
      .join("rect")
      .attr("x", (c) => c.ix * cellW)
      .attr("y", (c) => h - (c.iy + 1) * cellH)
      .attr("width", cellW - 1)
      .attr("height", cellH - 1)
      .attr("rx", 2)
      .attr("fill", accent)
      .attr("fill-opacity", (c) => 0.08 + (c.count / cellMax) * 0.55)
      .append("title")
      .text(
        (c) =>
          `${c.count} sellers in this cell\n` +
          `~${d3.format(",.0f")(Math.exp(logXmin + ((c.ix + 0.5) / BIN_X) * (logXmax - logXmin)))} listings · ` +
          `~$${d3.format(",.0f")(Math.exp(logYmin + ((c.iy + 0.5) / BIN_Y) * (logYmax - logYmin)))} avg`,
      );

    // Faint gridlines on top of density for axis reference.
    g.append("g")
      .selectAll("line")
      .data(y.ticks(6))
      .join("line")
      .attr("x1", 0)
      .attr("x2", w)
      .attr("y1", (d) => y(d))
      .attr("y2", (d) => y(d))
      .attr("stroke", chartTheme.axis)
      .attr("stroke-opacity", 0.18)
      .attr("stroke-dasharray", "1,3");
    g.append("g")
      .selectAll("line")
      .data(x.ticks(6))
      .join("line")
      .attr("y1", 0)
      .attr("y2", h)
      .attr("x1", (d) => x(d))
      .attr("x2", (d) => x(d))
      .attr("stroke", chartTheme.axis)
      .attr("stroke-opacity", 0.14)
      .attr("stroke-dasharray", "1,3");

    // Axes
    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6, d3.format(",")).tickSizeOuter(0))
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", w)
      .attr("y", 34)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("live listings (log)");

    g.append("g")
      .call(
        d3
          .axisLeft(y)
          .ticks(6, (v: d3.NumberValue) => `$${d3.format(",")(v as number)}`)
          .tickSizeOuter(0),
      )
      .call((sel) => sel.selectAll("text").attr("fill", chartTheme.axisText))
      .call((sel) => sel.selectAll("line,path").attr("stroke", chartTheme.axis))
      .append("text")
      .attr("x", 0)
      .attr("y", -8)
      .attr("fill", chartTheme.label)
      .text("avg listing price (log)");

    // Median reference line.
    const median =
      d3.quantile(
        rows.map((d) => d.avg_price!).sort((a, b) => a - b),
        0.5,
      ) ?? 0;
    if (median > 0 && median >= yMin && median <= yMax) {
      g.append("line")
        .attr("x1", 0)
        .attr("x2", w)
        .attr("y1", y(median))
        .attr("y2", y(median))
        .attr("stroke", chartTheme.warn)
        .attr("stroke-width", 1)
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.75);
      g.append("text")
        .attr("x", w - 4)
        .attr("y", y(median) - 6)
        .attr("text-anchor", "end")
        .attr("font-size", 10)
        .attr("font-family", "var(--font-mono)")
        .attr("fill", chartTheme.warn)
        .text(`market median $${d3.format(",.0f")(median)}`);
    }

    // Named top sellers on top of the density layer. Rank by
    // feedback count (the closest sold-volume proxy); show as a
    // bright ring + label so they read as "named outliers".
    const topN = w > 480 ? 12 : 8;
    const labelled = rows
      .slice()
      .sort((a, b) => (b.feedback_count ?? 0) - (a.feedback_count ?? 0))
      .slice(0, topN);

    const dotR = (d: BubbleSeller) =>
      3 + Math.min(9, Math.sqrt((d.feedback_count ?? 0) / 30));

    g.append("g")
      .selectAll("circle.named")
      .data(labelled)
      .join("circle")
      .attr("class", "named")
      .attr("cx", (d) => x(Math.max(MIN_LISTINGS, d.total_listings!)))
      .attr("cy", (d) => y(d.avg_price!))
      .attr("r", dotR)
      .attr("fill", "#f5ecd0")
      .attr("fill-opacity", 0.95)
      .attr("stroke", chartTheme.primary)
      .attr("stroke-width", 1.5)
      .append("title")
      .text(
        (d) =>
          `${d.seller_name ?? d.seller_id}\n${d.seller_location ?? ""}\n` +
          `listings: ${d.total_listings} · avg $${d3.format(",.0f")(d.avg_price!)}\n` +
          `feedback (≈ sold proxy): ${d.feedback_count ?? 0}`,
      );

    g.append("g")
      .selectAll("text.named")
      .data(labelled)
      .join("text")
      .attr("class", "named")
      .attr("x", (d) => x(Math.max(MIN_LISTINGS, d.total_listings!)) + dotR(d) + 4)
      .attr("y", (d) => y(d.avg_price!) + 3)
      .attr("font-size", 10)
      .attr("font-family", "var(--font-sans)")
      .attr("fill", chartTheme.label)
      .text((d) => (d.seller_name ?? d.seller_id).slice(0, 24));

    // Footer note: legend + filtered count.
    g.append("text")
      .attr("x", 0)
      .attr("y", h + 46)
      .attr("font-size", 10)
      .attr("font-family", "var(--font-mono)")
      .attr("fill", chartTheme.axisText)
      .text(
        `density = sellers per cell · named dots = top ${labelled.length} by feedback` +
          (filteredOut > 0
            ? ` · ${filteredOut.toLocaleString()} small sellers (<${MIN_LISTINGS} listings) excluded`
            : ""),
      );
  }, [data]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 440 }} />;
}
