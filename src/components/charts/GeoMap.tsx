"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";
import { parseSellerLocation } from "@/lib/sellers/location";

export type GeoSeller = {
  seller_id: string;
  seller_location: string | null;
  total_listings: number | null;
};

type FeatureLike = {
  type: "Feature";
  properties?: Record<string, unknown>;
  geometry: unknown;
};
type FeatureCollectionLike = { type: "FeatureCollection"; features: FeatureLike[] };

export default function GeoMap({ data }: { data: GeoSeller[] }) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [fc, setFc] = useState<FeatureCollectionLike | null>(null);

  const { byState, mapped, unmapped } = useMemo(() => {
    const m = new Map<string, { sellers: number; listings: number }>();
    let mp = 0;
    let um = 0;
    for (const d of data) {
      const state = parseSellerLocation(d.seller_location).usState;
      if (!state) {
        um++;
        continue;
      }
      mp++;
      const prev = m.get(state) ?? { sellers: 0, listings: 0 };
      m.set(state, {
        sellers: prev.sellers + 1,
        listings: prev.listings + (d.total_listings ?? 0),
      });
    }
    return { byState: m, mapped: mp, unmapped: um };
  }, [data]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [tc, mod] = await Promise.all([
        import("topojson-client"),
        import("us-atlas/states-10m.json"),
      ]);
      if (cancelled) return;
      const topo = ((mod as any).default ?? mod) as any;
      const features = tc.feature(topo, topo.objects.states) as any;
      setFc(features as FeatureCollectionLike);
    })().catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    if (!svgRef.current || !fc) return;

    const W = svgRef.current.clientWidth;
    const H = 480;
    svg.attr("viewBox", `0 0 ${W} ${H}`);

    const projection = d3.geoAlbersUsa().fitSize([W, H], fc as any);
    const path = d3.geoPath(projection as any);

    const maxSellers =
      d3.max(Array.from(byState.values()), (v) => v.sellers) ?? 1;
    const color = d3
      .scaleSequential()
      .domain([0, maxSellers])
      .interpolator(d3.interpolateRgb("#2a1710", chartTheme.primary));

    svg
      .append("g")
      .selectAll("path")
      .data(fc.features)
      .join("path")
      .attr("d", (f) => path(f as any) ?? "")
      .attr("fill", (f) => {
        const name = (f.properties?.name as string) ?? "";
        const v = byState.get(name)?.sellers ?? 0;
        return v > 0 ? color(v) : "#1f1f1f";
      })
      .attr("stroke", chartTheme.tooltipBorder)
      .attr("stroke-width", 0.5)
      .append("title")
      .text((f) => {
        const name = (f.properties?.name as string) ?? "";
        const s = byState.get(name);
        return s
          ? `${name}\n${s.sellers} sellers · ${s.listings} listings`
          : `${name}\nno sellers`;
      });

    const legendW = 140;
    const legendH = 8;
    const legendX = W - legendW - 16;
    const legendY = 24;

    const defs = svg.append("defs");
    const gradient = defs
      .append("linearGradient")
      .attr("id", "geo-map-scale")
      .attr("x1", "0%")
      .attr("x2", "100%");
    for (let i = 0; i <= 10; i++) {
      gradient
        .append("stop")
        .attr("offset", `${i * 10}%`)
        .attr("stop-color", color((i / 10) * maxSellers));
    }
    svg
      .append("rect")
      .attr("x", legendX)
      .attr("y", legendY)
      .attr("width", legendW)
      .attr("height", legendH)
      .attr("fill", "url(#geo-map-scale)")
      .attr("stroke", chartTheme.tooltipBorder);
    svg
      .append("text")
      .attr("x", legendX)
      .attr("y", legendY - 4)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text("sellers per state");
    svg
      .append("text")
      .attr("x", legendX)
      .attr("y", legendY + legendH + 12)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text("0");
    svg
      .append("text")
      .attr("x", legendX + legendW)
      .attr("y", legendY + legendH + 12)
      .attr("text-anchor", "end")
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text(`${maxSellers}`);

    svg
      .append("text")
      .attr("x", 16)
      .attr("y", H - 10)
      .attr("font-size", 10)
      .attr("fill", chartTheme.axisText)
      .text(`${mapped} US sellers mapped · ${unmapped} international/unmapped`);
  }, [fc, byState, mapped, unmapped]);

  return <svg ref={svgRef} className="w-full" style={{ minHeight: 480 }} />;
}
