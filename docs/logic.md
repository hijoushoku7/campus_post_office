# ロジック仕様書（logic.md）

Campus Post Office の**内部ロジック**を、現行実装に即してまとめたドキュメントです。
「どう動くか／なぜそうしているか」を把握するための技術リファレンスで、
セットアップ・運用手順は [DEPLOY.md](./DEPLOY.md)、要件・設計の背景は
[requirements.md](./requirements.md) / [design.md](./design.md) を参照してください。

各値の既定・環境変数名は [§9 設定値](#9-設定値-libconfigts) に集約しています。

---

## 1. プロセス / サーバ構成

### カスタムHTTPサーバ（[server.ts](../server.ts)）

Node の `createServer` で **Next.js と tus サーバを1プロセスに同居**させています。

- `/api/upload`（`TUS_PATH`）で始まるリクエスト → **tus ハンドラへ直接ルーティング**
- それ以外 → Next.js のリクエストハンドラ（`handle(req, res)`）
- `server.requestTimeout = 0` / `server.headersTimeout = 0` で**タイムアウトを無効化**
  （最大10GB・長時間のアップロード/ダウンロードを途中で切らないため）

> ⚠️ このため、起動は必ず `server.ts` を通す `npm run dev` / `npm run start` を使います。
> 素の `next dev` だと `/api/upload` が 404 になりアップロードが壊れます。

### NextAuth の2インスタンス構成（Edge / Node）

| インスタンス | 場所 | 依存 | 役割 |
|---|---|---|---|
| Edge | [middleware.ts](../middleware.ts) → [lib/auth.config.ts](../lib/auth.config.ts) | Prisma/argon2 を**含まない** | ルート保護・未ログインリダイレクト |
| Node | [lib/auth.ts](../lib/auth.ts) | Prisma + `@node-rs/argon2` | 認証本体・JWT callback・DB再検証 |

Edge ランタイムでは Prisma/argon2 が動かないため、設定を分離しています。

---

## 2. 認証・認可

### 資格情報フロー（[lib/auth.ts](../lib/auth.ts)）

1. email + password を `authorize` で検証
2. `prisma.user` を引き、**ユーザー実在 かつ `isActive === true`** を確認
3. `@node-rs/argon2` の `verify(passwordHash, password)` でパスワード照合
4. 監査ログ `LOGIN_SUCCESS` / `LOGIN_FAILED` を記録
5. 成功時 `{ id, email, role }` を返す

### JWT セッション戦略と DB 再検証

- セッションは **JWT のみ**（`Session` テーブルなし）。`session.user.id` は `token.sub`。
- JWT はステートレスなため、**無効化・削除されたユーザーでも有効期限内の Cookie で通り得る**。
  これを防ぐため `jwt` callback で定期的に DB を再検証する:
  - ログイン直後: `token.role` を取り込み、`token.dbCheckedAt = Date.now()` を記録
  - 以降: 前回検証から **`DB_REVALIDATE_MS = 10分`** 経過していたら
    `prisma.user.findUnique({ id: token.sub })` を実行
    - ユーザーが存在しない or `isActive === false` → **`null` を返してセッション失効**
    - それ以外 → `role` を DB の最新値に更新し `dbCheckedAt` を打ち直す
- 効果: 管理者がユーザーを無効化すると、**最長10分でアクセス不能**になる。

### ミドルウェアによるルート保護（[middleware.ts](../middleware.ts)）

- 公開パス: `/login`, `/invite`, `/api/register`, `/api/auth`
- 未ログインで非公開パスへ → `/login?callbackUrl=<元のパス>` へリダイレクト
- matcher 除外: `_next/static`, `_next/image`, `favicon.ico`, **`api/upload`**
  （tus は自前で `getToken()` 認証するため除外）

### 認可ヘルパ

- `isAdmin(session)` … `session?.user?.role === "ADMIN"`
- 所有者判定は各 API で `file.ownerId === session.user.id || isAdmin(session)`

---

## 3. アップロードフロー（tus, [lib/tus.ts](../lib/tus.ts)）

データストアは `@tus/file-store`（`config.uploadDir` 配下）。
`respectForwardedHeaders: true`、`disableTerminationForFinishedUploads: true`
（**完了済みアップロードは DELETE で削除させない**＝本体ファイルを保護）。

### `onIncomingRequest`（全メソッド共通の認証）

- OPTIONS はスキップ
- `getToken()`（`secureCookie` は HTTPS 判定）で JWT を取得。無ければ **401**
- 既存アップロードへの操作（POST 以外）は、メタデータの `ownerId` と
  ログインユーザーを照合し、不一致なら **403**

### `onUploadCreate`（作成時バリデーション）

1. DB でユーザー実在＋`isActive` を再確認（FK 違反防止）→ 不正なら **401**
2. `size > 0`、`size <= maxFileSize`（既定10GB）→ 違反で **400 / 413**
3. `hasFreeSpaceFor(size)`（`空き - size >= minFreeSpace`、既定20GB）→ 不足で **507**
4. 保管期限を `resolveExpiryDays()` で **1..maxExpiryDays（既定30）にクランプ**
   （メタデータは信用できないためサーバ側で丸める）
5. メタデータに `ownerId` を注入

### `onUploadFinish`（完了時：File レコード作成）

1. メタデータから `ownerId` を取得（無ければ File を作らずログのみ）
2. **完了までの間にユーザーが消えている可能性**があるため DB で再確認（FK 違反防止）
3. `prisma.file.create`:
   - `storagePath: upload.id`（FileStore はこの ID 名で保存）
   - `originalName` / `mimeType` はメタデータ由来、`size: BigInt(...)`
   - **`status: "SCANNING"`**、`expiresAt: expiryFromNow(expiryDays)`
4. `enqueueScan(file.id)` と `writeAudit(FILE_UPLOADED)` を
   それぞれ **`withTimeout(..., 10秒)`** で実行
   - Redis 等が応答しなくても 204 をブロックしない（クライアントが永久待ちにならない）
   - 失敗は握りつぶさず必ず `console.error` に残す

### クライアント側（[components/Uploader.tsx](../components/Uploader.tsx)）

- `tus-js-client`、`CHUNK_SIZE = 50MB`（Cloudflare の 1リクエスト100MB 制約回避）
- リトライ: `[0, 3000, 5000, 10000, 20000]`（ms）
- メタデータ: `{ filename, filetype, expiryDays }`
- 各アップロードに採番カウンタ由来の安定 `id` を付与し、`uploadsRef` Map で実体を保持
- **再開**: `findPreviousUploads()` で中断分があれば続きから
- **キャンセル**: `upload.abort(true)` で**サーバへ DELETE を送り部分データと再開情報を削除**。
  通信不良で消せなくても、残骸はワーカーの定期掃除で回収される（§5）
- 成功時に `FILES_CHANGED_EVENT` を dispatch して一覧を即時更新

---

## 4. ファイル状態マシン（`FileStatus`）

状態: `UPLOADING` / `SCANNING` / `READY` / `INFECTED` / `EXPIRED` / `DELETED`

```
        tus onUploadFinish
   (UPLOADING) ───────────────▶ SCANNING
                                   │
              scan worker          │ clean
        ┌──────────────────────────┼──────────────┐
        ▼ infected                 ▼ clean         │
     INFECTED                    READY             │
   (実体は削除済み)                                  │
                                                   │
   任意状態 ──DELETE API──▶ DELETED                 │
   任意状態 ──cleanup──────▶ EXPIRED (expiresAt 経過)
```

| 遷移 | 実行者 | 条件・ガード |
|---|---|---|
| → SCANNING | tus `onUploadFinish` | File 作成時の初期状態 |
| SCANNING → READY | scan worker | `updateMany({ id, status: SCANNING })` でスキャン clean 時 |
| SCANNING → INFECTED | scan worker | 同上。検出時に実体削除＋監査記録 |
| 任意 → DELETED | `DELETE /api/files/[id]` | 実体削除後に status 更新 |
| 任意 → EXPIRED | cleanup worker | `expiresAt < now()` かつ `status notIn [EXPIRED, DELETED]` |

**条件付き更新（`updateMany` ガード）が肝**:
scan は最大30分かかるため、その間にユーザーが削除すると
`status === "SCANNING"` 条件を満たさず `count === 0` になり、
**DELETED → READY への「復活」を防ぐ**（実体のない READY を作らない）。

UI / API の一覧クエリは `status notIn [DELETED, EXPIRED]` で除外
（共通化: [lib/file-query.ts](../lib/file-query.ts) の `visibleFileWhere(ownerId?)`）。

---

## 5. ワーカー（[worker/index.ts](../worker/index.ts)）

BullMQ。Queue とは別の専用 Redis 接続（`maxRetriesPerRequest: null`）。

### scan ワーカー（concurrency 2）

1. `findUnique(fileId)`。存在しない or `status !== "SCANNING"` なら何もしない
2. `scanPath(absPath)` で clamd `zSCAN`（既定タイムアウト **30分**）
3. clean → `updateMany({ id, status: SCANNING }, { status: READY })`
4. 検出 → 実体削除 → `updateMany({ id, status: SCANNING }, { status: INFECTED })`
   - `count === 0`（スキャン中に削除済み）なら監査記録もスキップ
   - 記録時は signature と originalName を付与（`FILE_INFECTED`）
- ジョブ: `attempts: 3`、指数バックオフ（5s 起点）

> ClamAV には `MaxFileSize/MaxScanSize`（約4GB上限）があり、
> 超過分は設定値まで・あるいは未スキャン扱いになる場合がある（[lib/clamd.ts](../lib/clamd.ts)）。

### cleanup ワーカー（**10分ごと**の繰り返しジョブ）

1ジョブで以下を順に実行:

1. **期限切れ削除**: `expiresAt < now()` かつ `status notIn [EXPIRED, DELETED]` を
   実体削除 → `EXPIRED` に更新 → 監査 `FILE_EXPIRED`
2. **放棄アップロード掃除**（`cleanupStaleUploads()`）:
   - `uploadDir` の `.json`（tus 再開メタ）を列挙
   - 対応する File レコードを `storagePath in (...)` で**一括取得**（N+1 回避）し Set 照合
   - **File あり（完了済み）** → `.json` だけ削除（本体は残す）
   - **File なし（未完了）** → 本体と `.json` の `mtime` を見て、
     **`staleUploadHours`（既定24h）より古ければ両方削除**
     （新しいものはユーザーが再開しうるので残す）
3. **監査ログ剪定**: `createdAt` が **`auditRetentionDays`（既定90日）** より古い
   `auditLog` を `deleteMany`（無限肥大の防止）

---

## 6. ダウンロード

### 共通: [lib/download.ts](../lib/download.ts) `buildDownloadResponse`

- 実体 `stat` が **ENOENT なら 404**（クリーンアップとのレース等で 500 にしない）
- ヘッダ: `Content-Disposition: attachment; filename*=UTF-8''<encoded>`（日本語名対応）、
  `Accept-Ranges: bytes`、`X-Content-Type-Options: nosniff`、`Cache-Control: private, no-store`
- **Range 対応**（再開DL）: `bytes=START-END` を解析し
  - 範囲不正（`start > end` / `start >= size`）→ **416**（`Content-Range: bytes */{size}`）
  - 正常 → **206**（`Content-Range: bytes {start}-{end}/{size}`）
- Range 無し → **200**（`Content-Length: {size}`）
- いずれも `createReadStream` → `Readable.toWeb()` でストリーム配信（低メモリ）

### 所有ファイル DL（[/api/files/[id]/download](../app/api/files/[id]/download/route.ts)）

ログイン必須 → 404 判定（DELETED/EXPIRED）→ **所有者 or admin** → `status === READY`
（それ以外は **409**）→ 監査 `FILE_DOWNLOADED` → 配信。

### 共有リンク DL（[/api/s/[token]/download](../app/api/s/[token]/download/route.ts)）

**ログイン必須**。`checkShare(token)`（§7）→
1. `storageFileExists()` で**実体確認（無ければ 410、回数を消費させない）**
2. `downloadCount` を**原子的に increment**
3. **increment 後の値**で `downloadCount > maxDownloads` を判定 → 超過なら **410**
   （チェック→加算の隙間に並行リクエストが入っても上限超過配信を防ぐ）
4. 監査 `FILE_DOWNLOADED`（`detail: { via: "share", shareId }`）→ 配信

---

## 7. 共有・招待

### `checkShare(token)`（[lib/share.ts](../lib/share.ts)）

早期 return 順: `not_found` → `revoked`(`revokedAt`) → `expired`(`expiresAt`) →
`limit`(`downloadCount >= maxDownloads`) → `unavailable`(`file.status !== READY`)。

### 共有作成（[POST /api/files/[id]/shares](../app/api/files/[id]/shares/route.ts)）

所有者/admin 確認 → body `{ expiresAt?, maxDownloads? }` →
**期限はファイル期限を上限にクランプ**（`min(requested, file.expiresAt)`）→
`generateToken()` で作成 → 監査 `SHARE_CREATED`。
失効は [DELETE /api/shares/[id]](../app/api/shares/[id]/route.ts) で `revokedAt` を立てる（`SHARE_REVOKED`）。

### `checkInvite(token)`（[lib/invite.ts](../lib/invite.ts)）

`not_found` → `accepted`(`acceptedAt`、1回限り) → `expired`。

### 招待作成・登録

- **作成**（[POST /api/invitations](../app/api/invitations/route.ts)、admin 限定）:
  作成者の実在確認 → `expiresAt = now() + inviteExpiryHours`（既定48h）→ 監査 `USER_INVITED`
- **登録**（[POST /api/register/[token]](../app/api/register/[token]/route.ts)、未ログイン）:
  `checkInvite` → password（8文字以上）を argon2 ハッシュ →
  **トランザクションで原子的に処理**:
  1. `updateMany({ token, acceptedAt: null }, { acceptedAt: now() })` で確保。
     `count === 0` → `ALREADY_USED`（**410**、二重登録防止）
  2. email 既存なら `EMAIL_TAKEN`（**409**）
  3. `user.create`（招待固定 email 優先、無ければ入力 email）
  - 成功で監査 `USER_CREATED`

### トークン（[lib/token.ts](../lib/token.ts)）

`generateToken()` = `randomBytes(32).toString("base64url")`（共有・招待共通、推測困難）。

---

## 8. ストレージ（[lib/storage.ts](../lib/storage.ts)）

- `resolveStoragePath(key)` … `path.resolve` で解決し、`base` 配下でなければ throw
  （**パストラバーサル防止**）
- `getFreeSpace()` … `statfs` の `bavail * bsize`（バイト）
- `hasFreeSpaceFor(size)` … `空き - size >= minFreeSpace`
- `storageFileExists(key)` … `access` の成否で boolean
- `deleteStorageFile(key)` … `unlink`。**ENOENT は無視**（冪等）、他は throw

---

## 9. 設定値（[lib/config.ts](../lib/config.ts)）

| キー | 環境変数 | 既定値 | 用途 |
|---|---|---|---|
| `publicBaseUrl` | `PUBLIC_BASE_URL` | `http://localhost:3000` | 共有/招待リンクのベースURL |
| `uploadDir` | `UPLOAD_DIR` | `/data/uploads` | 本体ファイル保存先 |
| `maxFileSize` | `MAX_FILE_SIZE` | 10GB | 1ファイル上限 |
| `defaultExpiryDays` | `DEFAULT_EXPIRY_DAYS` | 7 | 既定の保管期限（日） |
| `maxExpiryDays` | `MAX_EXPIRY_DAYS` | 30 | ユーザー指定の上限（日） |
| `inviteExpiryHours` | `INVITE_EXPIRY_HOURS` | 48 | 招待リンク有効期限（時間） |
| `uploadChunkSize` | `UPLOAD_CHUNK_SIZE` | 50MB | クライアントのチャンクサイズ |
| `staleUploadHours` | `STALE_UPLOAD_HOURS` | 24 | 未完了アップロードを放棄とみなす時間 |
| `auditRetentionDays` | `AUDIT_RETENTION_DAYS` | 90 | 監査ログ保持日数 |
| `minFreeSpace` | `MIN_FREE_SPACE` | 20GB | アップロード受理に必要な最低空き |
| `redisUrl` | `REDIS_URL` | `redis://redis:6379` | Redis 接続 |
| `clamav.host` | `CLAMAV_HOST` | `clamav` | ClamAV ホスト |
| `clamav.port` | `CLAMAV_PORT` | 3310 | ClamAV ポート |

`expiryFromNow(days)` = `now + days * 24h`（既定 `defaultExpiryDays`）。

---

## 10. データモデル（[prisma/schema.prisma](../prisma/schema.prisma)）

| モデル | 主要フィールド | インデックス / 関係 |
|---|---|---|
| `User` | `email`(unique), `passwordHash`, `role`, `isActive` | `files[]`, `invitations[]`, `shareLinks[]` |
| `File` | `ownerId`, `originalName`, `size`(BigInt), `storagePath`(unique), `status`, `expiresAt` | idx: `ownerId` / `expiresAt` / `status`、`shares[]` |
| `ShareLink` | `fileId`, `token`(unique), `expiresAt`, `revokedAt?`, `maxDownloads?`, `downloadCount`, `createdById` | idx: `fileId`、`file`(onDelete Cascade)、`createdBy`(User) |
| `Invitation` | `email?`, `token`(unique), `role`, `expiresAt`, `acceptedAt?`, `createdById` | `createdBy`(User "InvitedBy") |
| `AuditLog` | `userId?`, `action`, `targetType?`, `targetId?`, `result?`, `detail?`(Json) | idx: `userId` / `createdAt` / `action` |

- `token` は `@unique`（=インデックス）のため、重複する `@@index([token])` は持たない。
- enum: `Role`(ADMIN/MEMBER), `FileStatus`(§4), `AuditAction`（各操作）。

---

## 11. クライアント ポーリング / UX

### [components/FileList.tsx](../components/FileList.tsx)

- ポーリング間隔: 処理中（`UPLOADING`/`SCANNING`）があれば **`POLL_ACTIVE_MS = 3秒`**、
  安定したら **`POLL_IDLE_MS = 20秒`**
- **タブ非表示中（`visibilityState === "hidden"`）は fetch をスキップ**して次回だけ予約。
  `visibilitychange` で**復帰時に即時 `refresh()`**
- `FILES_CHANGED_EVENT`（`"cpo:files-changed"`）受信で即時再取得

### [components/FileRow.tsx](../components/FileRow.tsx)

- `READY` のみ「ダウンロード」「共有リンク」を表示
- 共有作成は POST → 成功でクリップボードへ自動コピー、失敗は `shareError` を表示
- 削除はインライン確認パネル → 成功でフェード後 `FILES_CHANGED_EVENT`、失敗は行を残しエラー表示

### [components/Uploader.tsx](../components/Uploader.tsx)

- 期限の選択肢 `EXPIRY_OPTIONS = [1,3,7,14,30]` を `maxExpiryDays` 以内に絞る
- アップロード状態: `uploading`（進捗＋キャンセル可）/ `done` / `error` / `canceled`

---

## 12. ローディング・遷移アニメーション

### ページ遷移ローディングの設計方針

固定秒スプラッシュ（旧 `SplashGate`）は廃止。ローディング表示の長さを**データ取得の完了**に合わせることで、
遅すぎる待機や「ちらつき」を回避する。

### `LoadingOverlay`（[components/LoadingOverlay.tsx](../components/LoadingOverlay.tsx)）

フルスクリーンのローディング幕。`PostOfficeLogo` を中央に配置し、
上下端にエアメールストライプを重ねる。`className` で外からアニメを差し込める共通基盤。

### `/files` のロード体験（2層構成）

```
ブラウザが /files を要求
  │
  ├─ RSC フェッチ中: loading.tsx (Suspense フォールバック)
  │    └─ LoadingOverlay "sorting the mail" をフルスクリーン表示
  │         (fetch が終わった瞬間に React が差し替え)
  │
  └─ コンテンツ表示後: RevealOverlay (page.tsx 内)
       └─ 同じ LoadingOverlay を最前面に重ね、0.5s かけてフェードアウト
            (React の Suspense は "差し替え" でアニメできないため、
             コンテンツ側に幕を持たせて自前でフェードする)
```

- **[app/files/loading.tsx](../app/files/loading.tsx)**: Next.js Suspense フォールバック。
  フルロード時（初回表示）と Client Navigation 時（`Link` / `router.push`）の両方で機能し、
  fetch 完了まで表示される。固定秒は不要。
- **[components/RevealOverlay.tsx](../components/RevealOverlay.tsx)**: `useEffect` で
  マウント直後に `setTimeout(500ms)` → `show = false` としてフェード消滅。
  `animate-fade-out` は `tailwind.config.ts` の `fade-out` キーフレーム（0.5s ease-in）。

### ログイン成功時の遷移

旧実装では `setTimeout(1200ms)` で固定秒後に遷移していた。
現行では `useTransition()` を使い、`router.push` / `router.refresh` が完了するまで
（= `/files` の RSC フェッチが終わるまで）`LoadingOverlay "delivering"` を表示し続ける。
**ネットワーク速度に追従する可変待機**で、ちらつきと過剰な待機の両方を防ぐ。
