"use client";
// Scatter: x = feedback_count (log), y = avg_price, size = total_listings,
// color = membership tier. Hover for full detail.
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

const MEMBERSHIP_COLOR: Record<string, string> = {
  Basic: "#6b6b6b",        // ink-500
  Premium: "#60a5fa",       // info
  Pro: "#b25929",           // claude
  Elite: "#f87171",         // danger
};

export default function SellerLeaderboardScatter({ data }: { data: Seller[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current) return;

    // Filter sellers we can actually place on the chart
    const rows = data.filter(
      (d) =>
        (d.feedback_count ?? d.seller_rating_score ?? 0) > 0 &&
        (d.avg_price ?? 0) > 0 &&
        (d.total_listings ?? 0) > 0,
    );
    if (rows.length === 0) return;

    const W = svgRef.current.clientWidth;
    const H = 440;
    const margin = { top: 16, right: 16, bottom: 44, left: 56 };
    const w = W - margin.left - margin.right;
    const h = H - margin.top - margin.bottom;

    const g = svg
      .attr("viewBox", `0 0 ${W} ${H}`)
      .append("g")
      .attr("transform", `translate(${margin.left},${margin.top})`);

    const x = d3
      .scaleLog()
      .domain([
        Math.max(1, d3.min(rows, (d) => d.feedback_count ?? d.seller_rating_score!) ?? 1),
        d3.max(rows, (d) => d.feedback_count ?? d.seller_rating_score!) ?? 10,
      ])
      .range([0, w]);

    const y = d3
      .scaleLinear()
      .domain([0, (d3.max(rows, (d) => d.avg_price!) ?? 500) * 1.1])
      .nice()
      .range([h, 0]);

    const r = d3
      .scaleSqrt()
      .domain([1, d3.max(rows, (d) => d.total_listings!) ?? 10])
      .range([3, 22]);

    g.append("g")
      .attr("transform", `translate(0,${h})`)
      .call(d3.axisBottom(x).ticks(6, d3.format(",")))
      .append("text")
      .attr("x", w)
      .attr("y", 32)
      .attr("text-anchor", "end")
      .attr("fill", chartTheme.label)
      .text("feedback count (log)");

    g.append("g")
      .call(d3.axisLeft(y).tickFormat((v) => `$${d3.format(",")(v as number)}`))
      .append("text")
      .attr("x", 4)
      .attr("y", -6)
      .attr("fill", chartTheme.label)
      .text("avg listing price");

    g.append("g")
      .selectAll("circle")
      .data(rows)
      .join("circle")
      .attr(
        "cx",
        (d) => x(Math.max(1, d.feedback_count ?? d.seller_rating_score ?? 1)),
      )
      .attr("cy", (d) => y(d.avg_price!))
      .attr("r", (d) => r(d.total_listings!))
      .attr("fill", (d) => MEMBERSHIP_COLOR[d.membership ?? ""] ?? "#6b6b6b")
      .attr("fill-opacity", 0.75)
      .attr("stroke", chartTheme.markerStroke)
      .attr("stroke-width", 1)
      .append("title")
      .text(
        (d) =>
          `${d.seller_name ?? d.seller_id}\n${d.seller_location ?? ""}\n` +
          `feedback: ${d.feedback_count ?? d.seller_rating_score} · ` +
          `listings: ${d.total_listings} · avg $${d3.format(",.0f")(d.avg_price!)}\n` +
          `membership: ${d.membership ?? "—"}`,
      );

    // Legend (membership colors)
    const legend = g.append("g").attr("transform", `translate(${w - 160}, 8)`);
    Object.entries(MEMBERSHIP_COLOR).forEach(([label, color], i) => {
      const gg = legend.append("g").attr("transform", `translate(0, ${i * 16})`);
      gg.append("circle").attr("r", 5).attr("fill", color).attr("cx", 6).attr("cy", 6);
      gg.append("text")
        .attr("x", 16)
        .attr("y", 10)
        .attr("font-size", 11)
        .attr("fill", chartTheme.label)
        .text(label);
    });
  }, [data]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 440 }} />;
}
