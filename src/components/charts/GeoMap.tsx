"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3";
import { chartTheme } from "./theme";

export type GeoSeller = {
  seller_id: string;
  seller_location: string | null;
  total_listings: number | null;
};

const US_STATES: ReadonlyArray<readonly [string, string]> = [
  ["Alabama", "AL"], ["Alaska", "AK"], ["Arizona", "AZ"], ["Arkansas", "AR"],
  ["California", "CA"], ["Colorado", "CO"], ["Connecticut", "CT"], ["Delaware", "DE"],
  ["Florida", "FL"], ["Georgia", "GA"], ["Hawaii", "HI"], ["Idaho", "ID"],
  ["Illinois", "IL"], ["Indiana", "IN"], ["Iowa", "IA"], ["Kansas", "KS"],
  ["Kentucky", "KY"], ["Louisiana", "LA"], ["Maine", "ME"], ["Maryland", "MD"],
  ["Massachusetts", "MA"], ["Michigan", "MI"], ["Minnesota", "MN"], ["Mississippi", "MS"],
  ["Missouri", "MO"], ["Montana", "MT"], ["Nebraska", "NE"], ["Nevada", "NV"],
  ["New Hampshire", "NH"], ["New Jersey", "NJ"], ["New Mexico", "NM"], ["New York", "NY"],
  ["North Carolina", "NC"], ["North Dakota", "ND"], ["Ohio", "OH"], ["Oklahoma", "OK"],
  ["Oregon", "OR"], ["Pennsylvania", "PA"], ["Rhode Island", "RI"], ["South Carolina", "SC"],
  ["South Dakota", "SD"], ["Tennessee", "TN"], ["Texas", "TX"], ["Utah", "UT"],
  ["Vermont", "VT"], ["Virginia", "VA"], ["Washington", "WA"], ["West Virginia", "WV"],
  ["Wisconsin", "WI"], ["Wyoming", "WY"], ["District of Columbia", "DC"],
];
// Match longer names first so "Virginia" doesn't swallow "West Virginia".
const STATES_BY_LEN = [...US_STATES].sort((a, b) => b[0].length - a[0].length);
const ABBR_TO_NAME: Record<string, string> = Object.fromEntries(
  US_STATES.map(([n, a]) => [a, n]),
);

function parseState(loc: string | null): string | null {
  if (!loc) return null;
  const lower = loc.toLowerCase();
  for (const [name] of STATES_BY_LEN) {
    if (lower.includes(name.toLowerCase())) return name;
  }
  const m = loc.match(/\b([A-Z]{2})\b/);
  if (m && ABBR_TO_NAME[m[1]]) return ABBR_TO_NAME[m[1]];
  return null;
}

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
      const state = parseState(d.seller_location);
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const topo = ((mod as any).default ?? mod) as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const projection = d3.geoAlbersUsa().fitSize([W, H], fc as any);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
