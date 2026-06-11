// ローディング用ロゴ: "post office" を1文字ずつウェーブさせる（プレゼンテーション専用）
const TEXT = "post office";
const STEP_MS = 90; // 文字ごとに波をずらす間隔

export function PostOfficeLogo({ caption }: { caption?: string }) {
  return (
    <div className="flex select-none flex-col items-center gap-7">
      <span className="postmark px-3 py-1 text-[10px]">PO</span>

      {/* aria-label でスクリーンリーダーには通常の語として読ませ、各 span は装飾扱い */}
      <h1
        aria-label="post office"
        className="flex font-display text-5xl font-semibold tracking-tight text-ink sm:text-7xl"
      >
        {TEXT.split("").map((ch, i) => (
          <span
            key={i}
            aria-hidden
            className="inline-block animate-wave motion-reduce:animate-none"
            style={{
              animationDelay: `${i * STEP_MS}ms`,
              ...(ch === " " ? { width: "0.42em" } : null),
            }}
          >
            {ch === " " ? " " : ch}
          </span>
        ))}
      </h1>

      {caption ? (
        <p className="font-mono text-[11px] uppercase tracking-[0.32em] text-muted">
          {caption}
        </p>
      ) : null}
    </div>
  );
}
