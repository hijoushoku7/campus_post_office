import { LoadingOverlay } from "@/components/LoadingOverlay";

// /files の RSC フェッチ中に表示する Suspense フォールバック。
// フルロード時はストリーミング SSR の初回フラッシュとして即座に流れ、
// クライアント遷移（ログイン後・Link）では取得完了まで表示される。
// いずれもデータが揃った瞬間に消えるので、固定秒ではなく fetch 駆動。
export default function Loading() {
  return <LoadingOverlay caption="sorting the mail" />;
}
