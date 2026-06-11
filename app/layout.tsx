import type { Metadata } from "next";
import { Fraunces, Newsreader, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SplashGate } from "@/components/SplashGate";

// 見出し: 個性的なセリフ
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "900"],
  variable: "--font-display",
  display: "swap",
});

// 本文: 読みやすく品のあるセリフ
const newsreader = Newsreader({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  style: ["normal", "italic"],
  variable: "--font-body",
  display: "swap",
});

// データ・ラベル: 書留番号 / トラッキング風モノスペース
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Campus Post Office — Secure Dispatch",
  description: "身内向けセキュアファイル共有 — 安全に届ける、内輪の郵便局",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="ja"
      className={`${fraunces.variable} ${newsreader.variable} ${jetbrains.variable}`}
    >
      <body>
        <SplashGate />
        {children}
      </body>
    </html>
  );
}
