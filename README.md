# Campus Post Office

身内のプロジェクト向け **セキュアファイル共有アプリ**。
自宅サーバー上の Docker で動作し、Cloudflare Tunnel で安全に公開します。

- 設計の詳細: [docs/requirements.md](docs/requirements.md) / [docs/design.md](docs/design.md)
- コンセプト: 「内輪の郵便局（ディスパッチデスク）」UI

## 特徴

- 🔐 アカウント制ログイン（招待制 / メール不要・リンク手渡し）
- 📦 最大 10GB の **再開可能チャンクアップロード**（tus, 50MB チャンク）
- 🔗 **ログイン必須の共有リンク**（トークン + 有効期限）
- 🦠 アップロード時 **ウイルススキャン**（ClamAV, 感染時は自動削除＋アプリ内通知）
- ⏳ **7日で自動削除**（期限切れジョブ）
- 📝 監査ログ
- 🌐 Cloudflare Tunnel（ポート開放・固定IP不要、TLSはCFが終端）

## アーキテクチャ

| サービス | 役割 |
|----------|------|
| `app` | Next.js (App Router) + tus（カスタムサーバ `server.ts`）。UI/API/アップロード |
| `worker` | BullMQ。ウイルススキャン・期限切れ削除（app と同一イメージ） |
| `postgres` | メタデータ・共有リンク・監査ログ |
| `redis` | ジョブキュー |
| `clamav` | ClamAV (clamd)。アップロードボリュームをパス指定スキャン |
| `cloudflared` | Cloudflare Tunnel |

技術スタック: TypeScript / Next.js 15 / Auth.js v5 (Credentials+JWT) / Prisma / tus / BullMQ / ClamAV

## セットアップ（自宅サーバー / Docker）

### 1. 環境変数

```bash
cp .env.example .env
```

`.env` を編集し、最低限以下を設定:

- `AUTH_SECRET` — `openssl rand -base64 32` で生成
- `POSTGRES_PASSWORD` / `DATABASE_URL` のパスワードを一致させる
- `PUBLIC_BASE_URL` — Cloudflare Tunnel で割り当てる公開URL（例 `https://files.example.com`）
- `TUNNEL_TOKEN` — Cloudflare ダッシュボードで発行した Tunnel トークン
- `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` — 初期管理者

### 2. ビルド & 起動

```bash
docker compose up -d --build
```

> ⏳ 初回は `clamav` がシグネチャDBをダウンロードするため数分かかります
> （DL完了まではスキャンジョブは待機・リトライされます）。

### 3. DB初期化 & 初期管理者作成

```bash
# スキーマ反映（初回。本番運用では migrate の利用を推奨）
docker compose run --rm app npx prisma db push

# 初期管理者を作成
docker compose run --rm app npm run seed
```

### 4. Cloudflare Tunnel の公開ホスト設定

Cloudflare Zero Trust ダッシュボードの Tunnel 設定で、
公開ホスト名（`PUBLIC_BASE_URL` のドメイン）→ **サービス `http://app:3000`** を割り当てます。

> ⚠️ Cloudflare は **1リクエスト 100MB** のアップロード上限があります。
> 本アプリは 50MB チャンクで送信するためこの制約下でも 10GB を送れますが、
> プランによる上限（Free/Pro=100MB）は変更しないでください。

### 5. アクセス

`PUBLIC_BASE_URL` を開く → 管理者でログイン → `/admin` で運用、`/files` で発送。

## ローカル開発

```bash
# 依存インストール
npm install

# DB/Redis/ClamAV だけ Docker で起動
docker compose up -d postgres redis clamav

# .env の DATABASE_URL 等を localhost 向けに調整のうえ
npm run prisma:generate
npm run prisma:migrate          # 開発用マイグレーション作成
npm run seed

# アプリ（カスタムサーバ）とワーカーを別ターミナルで
npm run dev
npm run worker:dev
```

## 運用メモ

- **ClamAV のメモリ**: シグネチャDB常駐で 2〜3GB 消費します。
- **スキャン上限**: ClamAV は概ね 4GB を超える部分をスキャンできません（`docker/clamav/clamd.conf` 参照）。
- **ディスク監視**: ローカルFS保存です。`MIN_FREE_SPACE` を下回るとアップロードを拒否します。
- **バックアップ**: `pg_data`（DB）を定期バックアップ推奨。ファイル本体は短期のため任意。
- **招待**: `/admin/invitations`（今後実装）で招待リンクを発行し、手動で手渡し。

## ディレクトリ構成

```
app/            Next.js (App Router) ページ & API
  login/  files/  s/[token]/  admin/  api/
components/      クライアントコンポーネント（Uploader, FileRow）
lib/             auth, db, tus, queue, storage, clamd, share, download, audit
worker/          BullMQ ワーカー（scan / cleanup）
prisma/          schema.prisma, seed.ts
docker/          Dockerfile.app, clamav/clamd.conf
server.ts        Next.js + tus 同居のカスタムサーバ
docker-compose.yml
```

## 実装状況（雛形）

- [x] 認証（ログイン / セッション / ルート保護）
- [x] アップロード（tus 再開可能・チャンク）
- [x] ファイル一覧 / ダウンロード（Range対応） / 削除
- [x] 共有リンク発行 / 受取 / 失効
- [x] ウイルススキャン・期限切れ削除（worker）
- [x] 管理ダッシュボード（統計・感染履歴・監査ログ）
- [ ] 招待フロー画面（`/admin/invitations`, `/invite/[token]`）
- [ ] ユーザー管理画面（`/admin/users`）
- [ ] パスワード変更（`/settings`）
- [ ] ログイン試行のレート制限
