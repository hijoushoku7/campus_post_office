import { PostOfficeLogo } from "./PostOfficeLogo";

// ロゴを中央に置くフルスクリーンのローディング幕。
// className でアニメーション（例: animate-splash-out）を差し込める。
export function LoadingOverlay({
  caption,
  className,
}: {
  caption?: string;
  className?: string;
}) {
  return (
    <div
      className={`fixed inset-0 z-[100] flex items-center justify-center bg-paper ${
        className ?? ""
      }`}
    >
      {/* 上下端にエアメールストライプ（署名要素） */}
      <div className="airmail-edge absolute inset-x-0 top-0 h-2" />
      <PostOfficeLogo caption={caption} />
      <div className="airmail-edge absolute inset-x-0 bottom-0 h-2 opacity-70" />
    </div>
  );
}
