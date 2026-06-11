"use client";

import dynamic from "next/dynamic";

// 初回スプラッシュはクライアント専用（sessionStorage 依存・初回描画を覆う）。
// ssr:false でサーバー描画を抑止し、ハイドレーション不一致を避ける。
const Splash = dynamic(
  () => import("./Splash").then((m) => m.Splash),
  { ssr: false },
);

export function SplashGate() {
  return <Splash />;
}
