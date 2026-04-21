"use client";
// Inline sparkline for tables. Takes raw numeric values and draws a thin line
// that fills its container. No axes, no ticks, no margin. Accessible via
// <title> tooltip so hovering shows first/last.
import { useEffect, useRef } from "react";
import * as d3 from "d3";

export default function Sparkline({
  values,
  width = 120,
  height = 24,
  color = "#2f7d32",
}: {
  values: number[];
  width?: number;
  height?: number;
  color?: string;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || values.length < 2) return;

    const x = d3.scaleLinear().domain([0, values.length - 1]).range([0, width]);
    const y = d3
      .scaleLinear()
      .domain(d3.extent(values) as [number, number])
      .range([height - 2, 2]);

    const line = d3
      .line<number>()
      .x((_, i) => x(i))
      .y((d) => y(d));

    svg.attr("viewBox", `0 0 ${width} ${height}`);
    svg
      .append("path")
      .datum(values)
      .attr("fill", "none")
      .attr("stroke", color)
      .attr("stroke-width", 1.5)
      .attr("d", line);

    // End-dot
    svg
      .append("circle")
      .attr("cx", x(values.length - 1))
      .attr("cy", y(values[values.length - 1]))
      .attr("r", 2)
      .attr("fill", color);
  }, [values, width, height, color]);

  return (
    <svg ref={svgRef} width={width} height={height}>
      <title>{values.length >= 2 ? `${values[0]} → ${values[values.length - 1]}` : "no data"}</title>
    </svg>
  );
}
