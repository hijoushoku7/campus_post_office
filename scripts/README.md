# 診断スクリプト

DB取得まわりのトラブルシュート用。`tsx` で直接実行する（テスト用フレームワーク不要）。

## diag:files — `/files` / `/api/files` が空になる原因の切り分け

`GET /api/files` が `{"files":[]}` を返す等、ファイルが取得できないときに使う。
アプリ本体([app/files/page.tsx](../app/files/page.tsx) と
[app/api/files/route.ts](../app/api/files/route.ts))と**同一の where 句**を再現し、
以下を一度に確認する。

1. `User` / `File` の実データ一覧
2. `File.ownerId` が実在 `User.id` と一致しているか（**orphan 検出**）
3. アプリと同一クエリで本当に 0 件になるか
4. `status`(DELETED/EXPIRED)条件で除外されているだけではないか

### 実行方法

`DATABASE_URL` が読める環境で実行する必要がある。本番は Docker Compose で
`postgres` サービスへ繋ぐため、**app コンテナ内で実行**するのが基本。

```bash
# Compose 環境（推奨）— env_file の DATABASE_URL がそのまま使われる
docker compose exec app npm run diag:files

# 特定ユーザーに絞って検証
docker compose exec app npm run diag:files -- user@example.com
```

ローカルで Postgres に直接繋げる場合は、その接続先を渡して実行してもよい:

```bash
# PowerShell
$env:DATABASE_URL = "postgresql://app:app_password@localhost:5432/campus_post_office?schema=public"
npm run diag:files

# bash
DATABASE_URL="postgresql://...:5432/campus_post_office?schema=public" npm run diag:files
```

> 注意: コンテナ内の `DATABASE_URL` はホスト名が `postgres`(Compose のサービス名)。
> ホストから直接実行する場合は `localhost` + 公開ポートに読み替えること。

### 出力の読み方

- `★ORPHAN` が付く File … その `ownerId` に対応する User が存在しない。
  アップロード時の `ownerId`(= JWT の `token.sub`)と、現在ログイン中の
  `session.user.id` が食い違っている。典型例は **DB再作成 / seed のやり直しで
  `User.id` が変わったのに、ブラウザに古い JWT Cookie が残っている**ケース。
  → 一度ログアウト→再ログインで解消する。
- `アプリクエリ=0 / status無視=N(>0)` … レコードはあるが全て DELETED/EXPIRED。
  期限切れや削除済み。意図通りなら正常。
- 対象 email のユーザーが居ない … 別アカウントでログインしている可能性。
