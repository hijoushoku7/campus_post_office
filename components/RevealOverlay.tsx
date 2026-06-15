"use client";

import { useEffect, useState } from "react";
import { LoadingOverlay } from "./LoadingOverlay";

// ローディング幕からコンテンツへの 0.5s フェードアウト。
// loading.tsx の Suspense フォールバックは React が即座に差し替えるため出口アニメが効かない。
// 代わりにコンテンツ側でこの幕を最前面に重ね、自分で 0.5s かけて消して中身を見せる。
const FADE_MS = 200;

export function RevealOverlay({ caption }: { caption?: string }) {
  const [show, setShow] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setShow(false), FADE_MS);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;
  return (
    <LoadingOverlay
      caption={caption}
      className="animate-fade-out motion-reduce:animate-none"
    />
  );
}
