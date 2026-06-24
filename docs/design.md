# 設計書：セキュアファイル共有アプリ

> ステータス: ドラフト v0.1
> 最終更新: 2026-06-07
> 前提: [requirements.md](./requirements.md) の確定事項に基づく

## 0. 技術スタック確定

| 領域 | 採用 | 備考 |
|------|------|------|
| 言語 | TypeScript | フロント/バック/Worker 共通 |
| フレームワーク | Next.js 15（App Router） | UI + API（API は Hono を catch-all Route Handler に集約 / [api-refactor.md](./api-refactor.md)） |
| 認証 | Auth.js (NextAuth v5) Credentials + DBセッション | 招待制・ログイン必須 |
| ORM | Prisma | PostgreSQL |
| DB | PostgreSQL 16 | メタデータ・監査ログ |
| アップロード | tus（@tus/server + @tus/file-store） | 再開可能チャンク（<100MB） |
| ジョブキュー | BullMQ + Redis | スキャン・期限削除 |
| ウイルススキャン | ClamAV（clamd） | 共有ボリュームをパス指定スキャン |
| 公開 | cloudflared（Cloudflare Tunnel） | TLSはCFエッジ終端 |
| ストレージ | ローカルFS（Dockerボリューム） | ファイル本体 |
| UI | Tailwind CSS + shadcn/ui（任意） | |

## 1. コンテナ構成（論理）

```
[Cloudflare エッジ] ──Tunnel──► [cloudflared] ──HTTP──► [app:3000]
                                                            │ (Next.js: UI/API/tus)
                                  共有DBボリューム            │
[worker] ◄── Redis ──► [app]                                │
   │  BullMQ consumer                                        │
   ├─ ClamAV(clamd:3310) でスキャン                          │
   └─ 期限切れ削除                                            │
[postgres:5432]  [redis:6379]  [clamav:3310]

ボリューム:
  - uploads_data : ファイル本体（app, worker, clamav が共有マウント）
  - pg_data      : PostgreSQL
  - clamav_db    : ClamAV シグネチャDB
```

- リバースプロキシは不要（cloudflared が `app:3000` に直接ルーティング）。
- `app`だけを外部`cloudflared_tunnel_net`と内部`backend`の両方へ接続する。
  `worker`、`postgres`、`redis`、`clamav`は`backend`のみに置き、公開経路から分離する。
- `clamav` はアップロードボリュームを **読み取り専用** でマウントし、`SCAN <path>` で検査
  （`INSTREAM` は `StreamMaxLength` の制約があり大容量ファイルに不向きなため採用しない）。

## 2. ロールと権限

| 操作 | member | admin |
|------|:---:|:---:|
| ログイン / パスワード変更 | ✓ | ✓ |
| アップロード | ✓ | ✓ |
| 自分のファイル一覧/詳細/削除 | ✓ | ✓ |
| 自分のファイルの共有リンク発行/失効 | ✓ | ✓ |
| 共有リンクからのDL（ログイン済み） | ✓ | ✓ |
| 全ファイル閲覧/削除 | ✗ | ✓ |
| ユーザー招待/作成/有効化・無効化 | ✗ | ✓ |
| 監査ログ閲覧 | ✗ | ✓ |
| ストレージ/感染アラート確認 | ✗ | ✓ |

## 3. 画面設計・遷移

### 3.1 ルート一覧（App Router）

| パス | 画面 | 認証 | 概要 |
|------|------|------|------|
| `/login` | ログイン | 不要 | メール＋パスワード |
| `/invite/[token]` | 招待受諾 | 不要 | メール確認＋パスワード設定→アカウント作成 |
| `/` | （リダイレクト） | 要 | `/files` へ |
| `/files` | マイファイル / アップロード | 要 | 一覧＋ドロップアップロード |
| `/files/[id]` | ファイル詳細 | 要 | 状態・期限・共有リンク管理 |
| `/s/[token]` | 共有ランディング | 要 | 未ログインなら`/login`へ→戻る。DLボタン |
| `/settings` | 設定 | 要 | パスワード変更 |
| `/admin` | 管理ダッシュボード | admin | 統計・ディスク・感染アラート |
| `/admin/users` | ユーザー管理 | admin | 一覧・有効/無効・ロール |
| `/admin/invitations` | 招待管理 | admin | 招待リンク発行・一覧・失効 |
| `/admin/audit` | 監査ログ | admin | 検索・絞り込み |

### 3.2 画面遷移図

```
[/login] ──成功──► [/files] ──アップロード──► （行内で進捗）──► [/files/:id]
   ▲                  │                                          │
   │未認証            ├─► [/settings]                            ├─ 共有リンク発行
   │                  └─► [/admin]（adminのみ）                   └─ 削除
[/invite/:token] ──設定完了──► [/login]

[共有リンク受領] ─► [/s/:token] ──未ログイン──► [/login] ──► [/s/:token] ──► DL
```

### 3.3 主要画面の要素

- **/files**: ドラッグ&ドロップ領域（tusアップローダ）、進行中アップロードの進捗バー（再開対応）、
  自分のファイル表（名前 / サイズ / 状態バッジ / 残り期限 / 操作）。
- **/files/[id]**: 状態（`scanning`はDL不可表示）、有効期限、共有リンク一覧（URL/期限/DL回数/失効ボタン）、
  「共有リンクを発行」ボタン、削除ボタン。
- **/s/[token]**: ファイル名・サイズ・期限、DLボタン。期限切れ/失効/感染時はその旨を表示。
- **/admin**: 総ファイル数・総容量・ディスク空き・**感染アラート（自動削除されたファイルの履歴）**。

## 4. DBスキーマ（Prisma）

```prisma
enum Role { ADMIN MEMBER }
enum FileStatus { UPLOADING SCANNING READY INFECTED EXPIRED DELETED }
enum AuditAction {
  LOGIN_SUCCESS LOGIN_FAILED LOGOUT
  USER_INVITED USER_CREATED USER_UPDATED
  FILE_UPLOADED FILE_DOWNLOADED FILE_DELETED FILE_EXPIRED FILE_INFECTED
  SHARE_CREATED SHARE_REVOKED
}

model User {
  id           String   @id @default(cuid())
  email        String   @unique
  passwordHash String
  role         Role     @default(MEMBER)
  isActive     Boolean  @default(true)
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  files        File[]
  sessions     Session[]
}

model Session {            // Auth.js DBセッション
  id           String   @id @default(cuid())
  sessionToken String   @unique
  userId       String
  expires      DateTime
  user         User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model Invitation {
  id         String   @id @default(cuid())
  email      String?              // 任意（指定すれば固定）
  token      String   @unique     // 推測困難（32byte base64url）
  role       Role     @default(MEMBER)
  expiresAt  DateTime
  acceptedAt DateTime?
  createdById String
  createdAt  DateTime @default(now())
}

model File {
  id           String     @id @default(cuid())
  ownerId      String
  owner        User       @relation(fields: [ownerId], references: [id])
  originalName String
  size         BigInt                       // 10GiB > 2^31 のため BigInt
  mimeType     String?
  storagePath  String     @unique            // ランダム名で保存（原名はDB）
  checksum     String?                       // 任意（SHA-256）
  status       FileStatus @default(UPLOADING)
  expiresAt    DateTime                       // 既定: 作成+7日
  createdAt    DateTime   @default(now())
  shares       ShareLink[]
  @@index([ownerId])
  @@index([expiresAt])
  @@index([status])
}

model ShareLink {
  id           String    @id @default(cuid())
  fileId       String
  file         File      @relation(fields: [fileId], references: [id], onDelete: Cascade)
  token        String    @unique
  expiresAt    DateTime
  revokedAt    DateTime?
  maxDownloads Int?
  downloadCount Int      @default(0)
  createdById  String
  createdAt    DateTime  @default(now())
  @@index([fileId])
}

model AuditLog {
  id         String      @id @default(cuid())
  userId     String?
  action     AuditAction
  targetType String?                          // "file" | "user" | "share" など
  targetId   String?
  ip         String?
  userAgent  String?
  result     String?                          // "ok" | "denied" | "error"
  detail     Json?
  createdAt  DateTime    @default(now())
  @@index([userId])
  @@index([createdAt])
  @@index([action])
}
```

> 進行中アップロードの状態は tus 側（`@tus/file-store` の `.json` サイドカー）が保持するため、
> 専用テーブルは設けず `File(status=UPLOADING)` とアップローダの進捗UIで表現する。

## 5. API設計（Route Handlers）

> 認証は Auth.js のセッション（HttpOnly Cookie）。`admin`系はロール検査。
> すべての書込み系操作で監査ログを記録。レスポンスは JSON（DLはストリーム）。
>
> **実装メモ:** API は `app/api/[[...route]]/route.ts` の Hono アプリ（`hono/vercel` の `handle`）に集約。
> 認証・所有権・バリデーションは `lib/api/middleware.ts` のミドルウェアで合成する。
> `/api/auth/*`（NextAuth）と `/api/upload*`（tus, server.ts 直結）は集約対象外。
> 設計・移行方針は [api-refactor.md](./api-refactor.md) を参照。本節のパス表記は当初案であり、
> 実装の正は `route.ts`（`/api/files`, `/api/invitations`, `/api/s/:token` 等）。

### 5.1 認証（Auth.js 標準）
- `POST /api/auth/callback/credentials` — ログイン
- `POST /api/auth/signout` — ログアウト
- `GET  /api/auth/session` — セッション取得

### 5.2 招待・アカウント
| メソッド/パス | 権限 | 概要 |
|---|---|---|
| `POST /api/admin/invitations` | admin | 招待作成 → `{ inviteUrl }` を返す（手渡し用） |
| `GET /api/admin/invitations` | admin | 招待一覧 |
| `DELETE /api/admin/invitations/:id` | admin | 招待失効 |
| `GET /api/invite/:token` | 公開 | 招待の有効性確認（email等を返す） |
| `POST /api/invite/:token/accept` | 公開 | `{ email?, password }` でユーザー作成 |
| `POST /api/admin/users` | admin | 手動作成 `{ email, password, role }` |
| `GET /api/admin/users` | admin | ユーザー一覧 |
| `PATCH /api/admin/users/:id` | admin | `{ isActive?, role? }` |
| `POST /api/me/password` | 要 | パスワード変更 |

### 5.3 アップロード（tus）
- エンドポイント: `/api/upload`（tus: `POST`(create) / `HEAD`(offset) / `PATCH`(append) / `DELETE`）
- `onUploadCreate` フック:
  - セッション検証（未ログインは拒否）
  - `Upload-Length` ≤ 10GiB を検証
  - **ディスク空き容量チェック**（不足なら拒否）
  - `File(status=UPLOADING)` を仮作成
- `onUploadFinish` フック:
  - 一意なストレージ名へ確定、`File` を `SCANNING` に更新、原名/サイズ/mime保存
  - BullMQ に **scan ジョブ** を投入
- クライアント: tus-js-client、`chunkSize = 50MB`（Cloudflare 100MB制約対策）、自動リトライ/再開。

### 5.4 ファイル
| メソッド/パス | 権限 | 概要 |
|---|---|---|
| `GET /api/files` | 要 | 自分のファイル一覧（adminは`?all=true`で全件） |
| `GET /api/files/:id` | 要(所有/admin) | 詳細 |
| `DELETE /api/files/:id` | 要(所有/admin) | 削除（FS実体＋メタ） |
| `GET /api/files/:id/download` | 要(所有/admin) | ストリーミングDL（Range対応） |

### 5.5 共有リンク
| メソッド/パス | 権限 | 概要 |
|---|---|---|
| `POST /api/files/:id/shares` | 要(所有/admin) | `{ expiresAt?, maxDownloads? }` → `{ shareUrl }` |
| `GET /api/files/:id/shares` | 要(所有/admin) | リンク一覧 |
| `DELETE /api/shares/:id` | 要(所有/admin) | 失効 |
| `GET /api/s/:token` | 要(ログイン) | 共有メタ取得（期限/失効/感染チェック） |
| `GET /api/s/:token/download` | 要(ログイン) | DL（Range対応、downloadCount++、上限チェック） |

### 5.6 管理
| メソッド/パス | 権限 | 概要 |
|---|---|---|
| `GET /api/admin/stats` | admin | 総数/総容量/ディスク空き/感染件数 |
| `GET /api/admin/audit` | admin | 監査ログ検索（`?action=&userId=&from=&to=`） |

## 6. 主要フロー

### 6.1 ログイン
1. `/login` でメール＋PW送信 → Auth.js Credentials が `passwordHash` を Argon2id 検証。
2. `isActive=false` は拒否。失敗はレート制限＋`LOGIN_FAILED`記録。
3. 成功でDBセッション発行（HttpOnly/Secure/SameSite=Lax Cookie）、`LOGIN_SUCCESS`記録。

### 6.2 招待 → アカウント作成
1. admin が `/admin/invitations` で招待作成 → `inviteUrl` を**手動で手渡し**（メール送信なし）。
2. 受領者が `/invite/:token` を開く → 有効性確認 → メール（未指定時）＋PW設定。
3. `User` 作成、`acceptedAt` 設定、`USER_CREATED`記録 → `/login` へ。

### 6.3 アップロード（再開可能・チャンク）
```
クライアント(tus, 50MBチャンク)
  → POST /api/upload (create) … onUploadCreate: 認証/サイズ/空き容量チェック, File=UPLOADING
  → PATCH 連続送信（断線時はHEADでoffset取得し再開）
  → 完了: onUploadFinish … File=SCANNING, scanジョブ投入
Worker(scan)
  → clamd に SCAN <path>（共有ボリューム）
  → クリーン: File=READY
  → 感染: 実体削除 + File=INFECTED + FILE_INFECTED記録 + 管理者アプリ内アラート
```

### 6.4 ダウンロード（直接 / 共有リンク）
1. 権限確認（所有者/admin、または有効な共有リンク＋ログイン）。
2. `status=READY` のみ許可（`SCANNING/INFECTED/EXPIRED` は拒否）。
3. `Range` ヘッダ対応でストリーミング配信（大容量・再開DL）。
4. 共有経由は `downloadCount++`、`maxDownloads` 超過で拒否。`FILE_DOWNLOADED`記録。

### 6.5 期限切れ自動削除（定期ジョブ）
- BullMQ の繰り返しジョブ（例: 10分毎）で `expiresAt < now` かつ未削除を抽出。
- FS実体削除 → `File=EXPIRED`、`FILE_EXPIRED`記録。
- tus の未完了（放置）アップロードも一定期間で掃除。

## 7. セキュリティ設計

- **パスワード**: Argon2id（`argon2` パッケージ）。
- **トークン**: `crypto.randomBytes(32)` を base64url（招待/共有）。当て推量・列挙不可。
- **保存名**: ランダム（cuid/uuid）でFS保存、原名はDBのみ。**パストラバーサル防止**（保存パスを固定ディレクトリ配下に強制）。
- **サイズ/容量**: tus作成時に10GiB上限＋ディスク空き検査。
- **認可**: ファイル/共有の所有者・admin チェックをサーバ側で必ず実施。
- **共有の二段防御**: 共有リンクは「ログイン必須」。部外者はリンク入手でもDL不可。
- **レート制限**: ログイン試行（Redis カウンタ）。
- **CSRF/XSS**: Auth.js のCSRF対策、SameSite Cookie、出力エスケープ。
- **ヘッダ**: ダウンロードは `Content-Disposition: attachment`＋原名、`X-Content-Type-Options: nosniff`。
- **監査**: すべての重要操作を `AuditLog` に記録。

## 8. ディレクトリ構成（予定 / 雛形フェーズで具体化）

```
campus_post_office/
├─ docs/
│   ├─ requirements.md
│   └─ design.md
├─ app/                         # Next.js (App Router)
│   ├─ (auth)/login/
│   ├─ invite/[token]/
│   ├─ files/  files/[id]/
│   ├─ s/[token]/
│   ├─ settings/
│   ├─ admin/  admin/users/  admin/invitations/  admin/audit/
│   └─ api/                     # Route Handlers
│       ├─ auth/[...nextauth]/
│       ├─ upload/              # tus ハンドラ
│       ├─ files/ shares/ s/
│       ├─ invite/
│       └─ admin/
├─ lib/                         # auth, db(prisma), tus, queue, audit, storage
├─ worker/                      # BullMQ コンシューマ（scan / cleanup）
├─ prisma/schema.prisma
├─ docker/                      # 各サービスの設定
│   ├─ Dockerfile.app
│   ├─ Dockerfile.worker
│   └─ cloudflared/ clamav/
├─ docker-compose.yml
└─ .env.example
```

> 注: tus は Next.js のカスタムサーバ（`server.ts`）で `app:3000` に同居させ
> `/api/upload` にマウントする方式を基本とする（コンテナ数を抑える）。
> 分離が必要なら独立 tus サービス化も可。

## 9. 環境変数（抜粋）

| 変数 | 用途 |
|------|------|
| `DATABASE_URL` | PostgreSQL接続 |
| `AUTH_SECRET` | Auth.js セッション署名 |
| `REDIS_URL` | BullMQ |
| `CLAMAV_HOST` / `CLAMAV_PORT` | clamd 接続 |
| `UPLOAD_DIR` | ファイル保存先（共有ボリューム） |
| `MAX_FILE_SIZE` | 既定10GiB（10GiBでハードクランプ） |
| `DEFAULT_EXPIRY_DAYS` | 既定 7 |
| `PUBLIC_BASE_URL` | 共有/招待URL生成用（CFのドメイン） |
| `TUNNEL_TOKEN` | cloudflared 認証トークン |

## 10. サーバ要件メモ

- **ClamAV はメモリを2〜3GB程度消費**（シグネチャDB常駐）。自宅サーバーのRAMを確認。
- ディスクは「同時保管ピーク容量＋余裕」を確保（10GiB×想定本数）。
- Cloudflare Tunnel 利用には **Cloudflare 管理下の独自ドメイン** が必要（未決事項）。
