import Link from "next/link";

/**
 * 左上に置く「戻る」用の四角いボックス型リンク。
 * 矢印＋ラベルで遷移先を一目で示す（ポストオフィス風の伝票カードに合わせた見た目）。
 */
export function BackLink({
  href,
  label,
  className = "",
}: {
  href: string;
  label: string;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={`card-paper group inline-flex items-center gap-1.5 px-3 py-1.5 transition hover:border-ink hover:bg-paper-deep ${className}`}
    >
      <span
        aria-hidden
        className="font-display text-sm leading-none transition-transform group-hover:-translate-x-0.5"
      >
        ←
      </span>
      <span className="font-mono text-[11px] tracking-[0.1em] text-ink">
        {label}
      </span>
    </Link>
  );
}
