"use client";
import { useEffect, useMemo, useRef } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type SunburstInput = {
  cached_traits: string | null;
  norm_traits: string | null;
};

type Node = { name: string; value?: number; children?: Node[] };

export default function Sunburst({
  data,
  maxGroups = 16,
}: {
  data: SunburstInput[];
  maxGroups?: number;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const root = useMemo<Node>(() => {
    const traitCounts = new Map<string, number>();
    for (const d of data) {
      const raw = (d.norm_traits || d.cached_traits || "").toLowerCase();
      if (!raw) continue;
      const tokens = raw.includes(",")
        ? raw.split(",").map((t) => t.trim())
        : raw.split(/\s+/).map((t) => t.trim());
      for (const t of tokens) {
        if (!t || t.length < 3) continue;
        traitCounts.set(t, (traitCounts.get(t) ?? 0) + 1);
      }
    }
    const groupMap = new Map<string, Node[]>();
    for (const [trait, count] of traitCounts.entries()) {
      if (count < 5) continue;
      const groupName = trait.split(/\s+/)[0];
      const children = groupMap.get(groupName) ?? [];
      children.push({ name: trait, value: count });
      groupMap.set(groupName, children);
    }
    const groups: Node[] = Array.from(groupMap.entries())
      .map(([name, children]) => ({
        name,
        children: children.sort((a, b) => (b.value ?? 0) - (a.value ?? 0)),
      }))
      .map((g) => ({
        ...g,
        _total: (g.children ?? []).reduce((s, c) => s + (c.value ?? 0), 0),
      }))
      .sort((a, b) => b._total - a._total)
      .slice(0, maxGroups)
      .map(({ _total: _unused, ...rest }) => rest);

    return { name: "Crested gecko", children: groups };
  }, [data, maxGroups]);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || !root.children?.length) return;

    const W = svgRef.current.clientWidth;
    const H = 480;
    const radius = Math.min(W, H) / 2 - 8;

    svg.attr("viewBox", `${-W / 2} ${-H / 2} ${W} ${H}`);

    const h = d3
      .hierarchy<Node>(root)
      .sum((d) => d.value ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const part = d3.partition<Node>().size([2 * Math.PI, radius])(h);

    const arc = d3
      .arc<d3.HierarchyRectangularNode<Node>>()
      .startAngle((d) => d.x0)
      .endAngle((d) => d.x1)
      .padAngle(0.005)
      .innerRadius((d) => d.y0)
      .outerRadius((d) => Math.max(d.y0, d.y1 - 1));

    const groupIndex = new Map<d3.HierarchyRectangularNode<Node>, number>();
    (part.children ?? []).forEach((g, i) => groupIndex.set(g, i));
    const colorFor = (d: d3.HierarchyRectangularNode<Node>): string => {
      let n: d3.HierarchyRectangularNode<Node> = d;
      while (n.depth > 1 && n.parent) n = n.parent as d3.HierarchyRectangularNode<Node>;
      const idx = groupIndex.get(n) ?? 0;
      return chartTheme.series[idx % chartTheme.series.length];
    };

    const arcs = part.descendants().filter((d) => d.depth > 0);

    svg
      .append("g")
      .selectAll("path")
      .data(arcs)
      .join("path")
      .attr("d", arc)
      .attr("fill", (d) => colorFor(d))
      .attr("fill-opacity", (d) => (d.depth === 1 ? 0.85 : 0.55))
      .attr("stroke", chartTheme.tooltipBorder)
      .attr("stroke-width", 0.5)
      .append("title")
      .text((d) => {
        const chain = d.ancestors().reverse().slice(1).map((n) => n.data.name).join(" › ");
        return `${chain}\n${d.value} listings`;
      });

    svg
      .append("g")
      .attr("pointer-events", "none")
      .selectAll("text")
      .data(arcs.filter((d) => d.x1 - d.x0 > 0.12))
      .join("text")
      .attr("transform", (d) => {
        const angle = ((d.x0 + d.x1) / 2) * (180 / Math.PI) - 90;
        const r = (d.y0 + d.y1) / 2;
        return `rotate(${angle}) translate(${r},0) rotate(${angle > 90 ? 180 : 0})`;
      })
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .attr("fill", "#f8f5ed")
      .attr("font-size", (d) => (d.depth === 1 ? 11 : 10))
      .style("paint-order", "stroke")
      .attr("stroke", "#0a0a0a")
      .attr("stroke-width", 2)
      .attr("stroke-opacity", 0.6)
      .text((d) => {
        const span = d.x1 - d.x0;
        const maxChars = Math.max(4, Math.floor(span * 20));
        const label = d.data.name;
        return label.length > maxChars ? label.slice(0, maxChars) + "…" : label;
      });

    svg
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.32em")
      .attr("fill", chartTheme.axisText)
      .attr("font-size", 11)
      .attr("font-family", "monospace")
      .text(`${root.children?.length ?? 0} trait families`);
  }, [root]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 480 }} />;
}
