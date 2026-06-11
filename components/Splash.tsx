"use client";

import { useEffect, useState } from "react";
import { LoadingOverlay } from "./LoadingOverlay";

// セッション中に一度だけ表示するためのフラグ
const FLAG = "po-splash-shown";
// animate-splash-out（1.7s）の総尺と一致させ、終了後に DOM から外す。
// reduced-motion でアニメが効かない場合の保険としてもこのタイマーで撤去する。
const TOTAL_MS = 1700;

// 初回アクセス時のスプラッシュ。2回目以降（同一タブセッション）は表示しない。
// SSR では描画しない前提（SplashGate が ssr:false で読み込む）なので、
// 初期値で sessionStorage を参照してもハイドレーション不一致は起きない。
export function Splash() {
  const [show, setShow] = useState(
    () => typeof window !== "undefined" && !sessionStorage.getItem(FLAG),
  );

  useEffect(() => {
    if (!show) return;
    sessionStorage.setItem(FLAG, "1");
    const timer = setTimeout(() => setShow(false), TOTAL_MS);
    return () => clearTimeout(timer);
  }, [show]);

  if (!show) return null;
  return (
    <LoadingOverlay
      caption="sorting the mail"
      className="animate-splash-out motion-reduce:animate-none"
    />
  );
}
