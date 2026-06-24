# Campus Post Office

招待されたメンバー間で大容量ファイルを受け渡すための、セルフホスト型ファイル共有アプリです。
Next.jsの画面・APIとtusアップロードサーバを1プロセスで動かし、アップロード後のウイルススキャンと期限切れ削除をBullMQワーカーで非同期処理します。

## 主な機能

- Auth.js Credentials認証とJWTセッション
- 管理者が発行する1回限りの招待リンク
- 最大10GiBの再開可能アップロード（tus、50MiBチャンク）
- ClamAVによるアップロード後のパス指定スキャン
- ファイル所有者または管理者によるダウンロード・削除
- ログイン必須の共有リンク、有効期限、失効、ダウンロード回数制限
- HTTP Range対応のストリーミングダウンロード
- ファイル期限切れ、放棄されたアップロード、古い監査ログの定期削除
- 管理ダッシュボード、感染履歴、操作ログ

匿名アップロードと匿名ダウンロードには対応していません。

## 技術構成

| 領域 | 採用技術 |
|---|---|
| Web | Next.js 16 App Router、React 19、TypeScript |
| API | Hono 4、Zod |
| 認証 | Auth.js v5 Credentials、Argon2id、JWTセッション |
| DB | PostgreSQL 16、Prisma 6 |
| アップロード | tus server / tus-js-client、ローカルファイルシステム |
| 非同期処理 | BullMQ 5、Redis 7 |
| マルウェア検査 | ClamAV clamd |
| スタイル | Tailwind CSS 3 |
| 実行環境 | Node.js 20、Docker Compose |

通常のAPIは[Hono catch-all Route Handler](app/api/[[...route]]/route.ts)に集約しています。
例外として、`/api/auth/*`はAuth.js、`/api/upload*`は[カスタムHTTPサーバ](server.ts)からtusへ直接ルーティングされます。

## コンテナ構成

```text
                         external: cloudflared_tunnel_net
                    ┌────────────────────────────────────┐
Traefik / Tunnel ──►│ app :3000                          │
                    └──────────────┬─────────────────────┘
                                   │
                         internal: backend
              ┌────────────────────┼─────────────────────┐
              │                    │                     │
         PostgreSQL              Redis                worker
                                                       │
                                                     ClamAV
```

- `app`だけが外部`cloudflared_tunnel_net`と内部`backend`の両方に接続します。
- `postgres`、`redis`、`clamav`、`worker`は`backend`にのみ接続します。
- `app`と`worker`は同じイメージを使用します。
- `app`と`worker`はアップロードボリュームを読み書きし、ClamAVは読み取り専用で参照します。
- Cloudflare TunnelやTraefik自体はこのComposeには含まれません。

## 必要環境

- Docker Engine / Docker Compose
- 外部Dockerネットワーク`cloudflared_tunnel_net`
- そのネットワークに接続されたTraefikまたはCloudflare Tunnel側のプロキシ
- ClamAV用を含め、最低4GiB程度のメモリ
- アップロードファイルと`MIN_FREE_SPACE`を収容できるディスク

外部ネットワークが未作成の場合:

```bash
docker network create cloudflared_tunnel_net
```

## セットアップ

### 1. 環境変数

```bash
cp .env.example .env
openssl rand -base64 32
```

`.env`では最低限、次を変更してください。

```dotenv
PUBLIC_BASE_URL=https://files.example.com
AUTH_SECRET=<生成したランダム値>

POSTGRES_USER=app
POSTGRES_PASSWORD=<強いパスワード>
POSTGRES_DB=campus_post_office
DATABASE_URL=postgresql://app:<同じパスワード>@postgres:5432/campus_post_office?schema=public

SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=<強いパスワード>
```

主要な調整値:

| 環境変数 | 既定値 | 用途 |
|---|---:|---|
| `MAX_FILE_SIZE` | 10GiB | 1ファイルの上限。コード上も10GiBでクランプ |
| `MIN_FREE_SPACE` | 20GiB | アップロード受理後も残す最低空き容量 |
| `DEFAULT_EXPIRY_DAYS` | 7 | 既定の保管日数 |
| `MAX_EXPIRY_DAYS` | 30 | ユーザーが指定できる保管日数の上限 |
| `INVITE_EXPIRY_HOURS` | 48 | 招待リンクの有効時間 |
| `STALE_UPLOAD_HOURS` | 24 | 未完了アップロードを削除するまでの時間 |
| `AUDIT_RETENTION_DAYS` | 90 | アプリ内監査ログの保持日数 |

`docker-compose.yml`のTraefikホストルールはデプロイ先に合わせて変更してください。

```yaml
traefik.http.routers.sharefile.rule=Host(`files.example.com`)
```

この値と`PUBLIC_BASE_URL`のホスト名を一致させます。

### 2. 起動

```bash
docker compose up -d --build
```

初回起動時はClamAVのシグネチャ取得に数分かかることがあります。

### 3. DB初期化

このリポジトリには現時点でPrisma migration履歴がないため、初期構築では`db push`を使用します。

```bash
docker compose run --rm app npx prisma db push
docker compose run --rm app npm run seed
```

### 4. 動作確認

```bash
docker compose ps
docker compose logs -f app worker clamav
```

`PUBLIC_BASE_URL`へアクセスし、初期管理者でログインします。

## ClamAVと10GiBファイル

アップロード本体はClamAVコンテナにも`/data/uploads`としてマウントされ、workerがclamdへ`SCAN <path>`を送ります。ファイル内容をTCPで送る`INSTREAM`は使用しません。

[clamd.conf](docker/clamav/clamd.conf)の主要設定:

```conf
MaxFileSize 0
MaxScanSize 10G
StreamMaxLength 100M
MaxScanTime 1800000
```

- 入力ファイルサイズはアプリ側で10GiB以下に制限します。
- `MaxFileSize 0`でclamd側の入力ファイル上限を無効化します。
- 展開後データの検査量は`MaxScanSize 10G`までです。
- 暗号化アーカイブの内容は検査できません。
- 10GiB近いファイルのスキャン時間とI/O負荷は、ファイル形式とサーバ性能に依存します。

## 開発

依存関係をインストールします。

```bash
npm ci
npm run prisma:generate
```

アプリとworkerは別プロセスで起動します。

```bash
npm run dev
npm run worker:dev
```

ローカルNode.jsから起動する場合、PostgreSQL、Redis、ClamAVへ接続できるよう`.env`の接続先をローカル環境に合わせる必要があります。現在のComposeは内部サービスのポートをホストへ公開していないため、必要なら開発用Compose overrideを用意してください。

品質チェック:

```bash
npm run typecheck
npm run lint
npm run build
```

## 主要ルート

| パス | 用途 |
|---|---|
| `/login` | ログイン |
| `/files` | アップロードと自分のファイル管理 |
| `/s/:token` | ログイン必須の共有ファイル受取 |
| `/invite/:token` | 招待からのアカウント登録 |
| `/admin` | 管理ダッシュボードと招待発行 |
| `/admin/files` | 管理者向け全ファイル一覧 |
| `/api/upload` | tusアップロード |
| `/api/auth/*` | Auth.js |
| `/api/*` | Hono API |

## ファイル状態

```text
upload complete
      │
      ▼
  SCANNING ── clean ──► READY ── expiry ──► EXPIRED
      │                   │
      └─ infected ─► INFECTED
                          │
READY / SCANNING ── user delete ──► DELETED
```

`READY`になるまでダウンロードと共有はできません。感染ファイルの実体は自動削除されます。

## ディレクトリ

```text
app/             Next.jsページ、Auth.jsルート、Hono API
components/      アップローダー、ファイル一覧、管理UI
lib/             認証、DB、tus、ストレージ、ClamAV、キュー
worker/          スキャンと定期削除のBullMQ worker
prisma/          Prisma schema、初期管理者seed
docker/          アプリイメージとClamAV設定
docs/            要件、設計、ロジック、デプロイ資料
server.ts        Next.jsとtusを同居させるHTTPサーバ
docker-compose.yml
```

## 現在の制約

- Redis認証は未導入です。Redisは`backend`ネットワークからのみ到達できます。
- アプリ側のログインレート制限は未導入です。公開環境ではCloudflare側で制限してください。
- ユーザー管理画面とパスワード変更画面は未実装です。
- ファイル一覧は最大1000件で、ページネーションは未実装です。
- 自動テストは未整備です。

## 詳細資料

- [要件](docs/requirements.md)
- [設計](docs/design.md)
- [内部ロジック](docs/logic.md)
- [デプロイ手順](docs/DEPLOY.md)
- [APIリファクタリング](docs/api-refactor.md)
