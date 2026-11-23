"use client";
// TradingView Advanced Chart (official embed widget). Shows the market reference price; the game
// itself always executes at the onchain Pyth Lazer oracle price shown next to the chart.
import { memo, useEffect, useRef } from "react";

export type TvInterval = "1" | "5" | "15";

function TVChartInner({ symbol, interval, height }: { symbol: string; interval: TvInterval; height?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    host.innerHTML = "";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    widget.style.height = "100%";
    widget.style.width = "100%";
    host.appendChild(widget);
    const script = document.createElement("script");
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.type = "text/javascript";
    script.async = true;
    script.innerHTML = JSON.stringify({
      autosize: true,
      symbol,
      interval,
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      backgroundColor: "#0c1018",
      gridColor: "rgba(255, 255, 255, 0.04)",
      hide_top_toolbar: true,
      hide_side_toolbar: true,
      hide_legend: false,
      hide_volume: true,
      allow_symbol_change: false,
      save_image: false,
      calendar: false,
      withdateranges: false,
      details: false,
      support_host: "https://www.tradingview.com",
    });
    host.appendChild(script);
    return () => {
      host.innerHTML = "";
    };
  }, [symbol, interval]);
  // TradingView's autosize rewrites its container to height:100%, so the fixed height lives on
  // a wrapper the widget script never touches.
  return (
    <div className="h-full w-full overflow-hidden" style={height ? { height } : undefined}>
      <div ref={ref} className="tradingview-widget-container h-full w-full" />
    </div>
  );
}

export const TVChart = memo(TVChartInner);
