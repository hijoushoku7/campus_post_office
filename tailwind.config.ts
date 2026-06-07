import type { Config } from "tailwindcss";

export default {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-display)", "Georgia", "serif"],
        body: ["var(--font-body)", "Georgia", "serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      colors: {
        // 郵便局ディスパッチデスクのパレット
        paper: "#f1ead9", // クラフト紙クリーム
        "paper-deep": "#e7dcc4",
        ink: "#211c16", // 温かい黒インク
        muted: "#6f6553",
        line: "#cdc1a6",
        postal: "#b22222", // 郵便赤（消印・封蝋）
        "postal-deep": "#8c1818",
        airmail: "#13427a", // エアメール青
        stamp: "#2f7d4f", // 検疫済み（クリーン）グリーン
      },
      boxShadow: {
        desk: "0 1px 0 #fff8, 0 18px 40px -24px rgba(33,28,22,0.45)",
      },
      keyframes: {
        "stamp-in": {
          "0%": { opacity: "0", transform: "rotate(-18deg) scale(1.6)" },
          "60%": { opacity: "1" },
          "100%": { opacity: "1", transform: "rotate(-9deg) scale(1)" },
        },
        "rise-in": {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "stamp-in": "stamp-in 0.5s cubic-bezier(0.2,0.8,0.2,1) both",
        "rise-in": "rise-in 0.6s cubic-bezier(0.2,0.8,0.2,1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;
