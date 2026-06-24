# API実装の Hono 移行（実装済み）

> ステータス: 実装済み（案A採用）
> 最終更新: 2026-06-24
> 対象: `app/api/**` の Route Handlers
> 前提: [design.md](./design.md) / [CLAUDE.md](../CLAUDE.md) のアーキテクチャに準拠
>
> **実装サマリ:** 案A（catch-all + `hono/vercel`）で全9エンドポイントを
> `app/api/[[...route]]/route.ts` に集約。横断的関心事は `lib/api/middleware.ts`
> （`requireAuth` / `requireAdmin` / `requireFileOwner` / `requireReady` /
> `requireShareOwner`）に集約し、`app/api/[[...route]]/route.ts` の `app.onError` /
> `app.notFound` でエラーを一元整形。バリデーションは `@hono/zod-validator`。
> `/api/auth/*`（NextAuth）と `/api/upload*`（tus）は集約対象外（当初方針どおり）。
> レスポンス形状は旧 Route Handlers と一致させ、フロントの fetch 先URLは不変。
> 検証: `npm run typecheck` / `npm run lint` 通過。

## 0. 目的と結論

現状の Route Handlers に存在する **認証・所有権チェック・バリデーション・エラー整形の重複**を解消することが本検討の主目的。
Hono 導入はその一手段だが、APIが小規模（9本）であるため**費用対効果は限定的**。本書では選択肢を比較し、移行する場合の手順を示す。

**結論（推奨）:**

1. 第一推奨は **軽量ラッパー方式**（Hono非導入）。依存追加ゼロ・`auth()` 統合への影響なし・低リスクで重複を解消できる。
2. 将来的にAPIの本数増加・型付きRPCクライアント共有の展望が出た場合に限り、**Hono（案A: catch-all + `hono/vercel`）** へ移行する。
3. **案B（`server.ts` 直結）は不採用**。tus + NextAuth との統合を壊すリスクが高い。

## 1. 現状のAPI棚卸し

| エンドポイント | メソッド | 認可 | 備考 |
|---|---|---|---|
| `/api/files` | GET | ログイン（`?all=true` は管理者のみ） | 一覧、`take:1000` 上限 |
| `/api/files/[id]` | DELETE | 所有者 or 管理者 | 論理削除 + 実体削除 |
| `/api/files/[id]/download` | GET | 所有者 or 管理者 | Range対応・監査ログ |
| `/api/files/[id]/shares` | GET / POST | 所有者 or 管理者 | 共有リンク一覧/発行 |
| `/api/shares/[id]` | DELETE | 所有者 or 管理者 | revoke |
| `/api/invitations` | POST | 管理者 | 招待発行・実在確認 |
| `/api/register/[token]` | POST | 未ログイン | 招待受諾・トランザクション |
| `/api/s/[token]` | GET | ログイン | 共有メタ情報 |
| `/api/s/[token]/download` | GET | ログイン | 共有DL・原子的カウント |
| `/api/auth/[...nextauth]` | GET / POST | NextAuth | **移行対象外** |

### Hono化の対象外（重要）

- **`/api/upload*`（tus）**: `server.ts` で Next.js を介さず直結。`getToken()` で独自認証。本検討の範囲外。
- **`/api/auth/[...nextauth]`**: NextAuth のハンドラ。Hono の外に維持する。

→ 実質的に集約対象は**上記9本のみ**。

## 2. 重複している横断的関心事

全ハンドラに散在し、ラッパー/middlewareで集約可能な定型:

```ts
// 1. 認証（全ハンドラ）
const session = await auth();
if (!session?.user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

// 2. 管理者判定（invitations, files?all）
if (!isAdmin(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

// 3. 所有権ロード（download / delete / shares で重複、loadOwnedFile と同等ロジック）
const file = await prisma.file.findUnique({ where: { id } });
if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
if (file.ownerId !== session.user.id && !isAdmin(session)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

// 4. パラメータ取得 + zod 検証 + 400 整形（shares, invitations, register）
const body = await req.json().catch(() => ({}));
const parsed = schema.safeParse(body);
if (!parsed.success) return NextResponse.json({ error: "invalid body" }, { status: 400 });
```

## 3. 選択肢の比較

| 観点 | 軽量ラッパー（推奨1） | 案A: Hono catch-all | 案B: server.ts 直結 |
|---|---|---|---|
| 依存追加 | なし | `hono`, `@hono/zod-validator` | 同左 + `@hono/node-server` |
| `auth()` への影響 | なし | なし（Next ライフサイクル内） | **要書き換え**（`getToken()` 化） |
| `server.ts` 変更 | なし | なし | あり（tus と並列ルーティング） |
| NextAuth 統合 | 維持 | 維持（別ルート） | **崩れる範囲が広い** |
| 重複排除 | ◯ | ◎（middleware一元化） | ◎ |
| 学習コスト | 低 | 中 | 中 |
| 将来拡張・RPC型共有 | △ | ◎ | ◎ |
| リスク | 低 | 低〜中 | 高 |

## 4. 推奨1: 軽量ラッパー方式（Hono非導入）

`lib/api/` に高階関数を用意し、各 Route Handler から定型を排除する。

```ts
// lib/api/guards.ts （イメージ）
export function withAuth(
  handler: (ctx: { req: Request; session: Session; params: Record<string, string> }) => Promise<Response>,
) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    const session = await auth();
    if (!session?.user) return json({ error: "unauthorized" }, 401);
    return handler({ req, session, params: await ctx.params });
  };
}

export function withAdmin(handler) { /* withAuth + isAdmin → 403 */ }

export async function loadOwnedFile(id: string, session: Session) {
  // 404 / 403 を Response で返す既存 loadOwnedFile を共通化（files/[id]/shares から移設）
}

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status });
}
```

使用例（`/api/files/[id]/download`）:

```ts
export const GET = withAuth(async ({ req, session, params }) => {
  const r = await loadReadyFile(params.id, session); // 404/409/403 を内包
  if (r.error) return r.error;
  await writeAudit({ /* ... */ });
  return buildDownloadResponse(r.file.storagePath, r.file.originalName, r.file.mimeType, req.headers.get("range"));
});
```

**メリット:** 依存ゼロ、`auth()`/NextAuth/tus に無影響、`typecheck`+`lint` のみで検証可能、段階導入可。
**デメリット:** ルーティング/バリデーションの宣言的記述は Hono ほど洗練されない。

## 5. 案A: Hono（catch-all + `hono/vercel`）

将来拡張を見込む場合の移行先。

### 構成

```
app/api/[[...path]]/route.ts   ← Hono アプリを hono/vercel でエクスポート
  └─ export const { GET, POST, DELETE } = handle(app)
```

- `/api/auth/[...nextauth]/route.ts` は**そのまま残す**（catch-all より具体的なルートが優先される）。
- `server.ts` は無改造（`/api/upload` 以外は従来どおり Next へ委譲 → catch-all が受ける）。

### スケッチ

```ts
import { Hono } from "hono";
import { handle } from "hono/vercel";
import { zValidator } from "@hono/zod-validator";

const app = new Hono().basePath("/api");

// 認証 middleware（auth() は next/headers 依存だが route handler 内なので動作する）
const requireAuth = createMiddleware(async (c, next) => {
  const session = await auth();
  if (!session?.user) return c.json({ error: "unauthorized" }, 401);
  c.set("session", session);
  await next();
});

app.get("/files", requireAuth, async (c) => { /* ... */ });
app.delete("/files/:id", requireAuth, async (c) => { /* ... */ });
app.post("/files/:id/shares", requireAuth, zValidator("json", createSchema), async (c) => { /* ... */ });
// /s/:token, /shares/:id, /invitations, /register/:token も同様

export const GET = handle(app);
export const POST = handle(app);
export const DELETE = handle(app);
```

### 検証が必要な論点

- **`auth()` の動作**: catch-all route handler は Next リクエストライフサイクル内なので `next/headers` 依存の `auth()` は動くはず。要 PoC 確認。
- **ストリーミング/Range ダウンロード**: `buildDownloadResponse` は `Response` を返すため、Hono ハンドラでそのまま `return` 可能。
- **ルート優先順位**: `[...nextauth]` と `[[...path]]` の解決順を要確認（具体ルート優先のはず）。
- **middleware.ts**: 既存の edge 認証はパス単位なので変更不要。

### 5.1 ミドルウェア設計（Hono移行の主目的）

「ミドルウェアを差し込みやすい構造にする」ことが本移行の最大の動機。現状は横断的関心事が全9ハンドラにコピペで散在しており、新しい関心事を1つ足すたびに9ファイルを触る必要がある。Honoではルート定義への**合成**と `app.use()` による**パス単位の一括適用**で、追加が1箇所で全体に効く。

#### 横断的関心事の現状とHonoでの集約先

| 関心事 | 現状 | Honoでの集約先 |
|---|---|---|
| 認証（401） | 全9ハンドラに `auth()` + 分岐 | `requireAuth` ミドルウェア |
| 管理者判定（403） | invitations / files?all で個別 | `requireAdmin` ミドルウェア |
| 所有権ロード（404/403） | download / delete / shares に重複（`loadOwnedFile`相当） | `requireFileOwner` ミドルウェア |
| ステータス確認（409） | download 内にインライン | `requireReady` ミドルウェア |
| バリデーション（400） | `json().catch` → `safeParse` の3行定型 | `zValidator("json", schema)` |
| 監査ログ | 各ハンドラで `writeAudit` 個別呼び出し | `app.use` の監査ミドルウェア（or ヘルパ維持） |
| エラー整形 | register のみ try/catch、形状混在 | `app.onError` で一元化 |
| レート制限 | なし | 招待発行・`/s/:token/download` に後付け |

#### 認可ミドルウェアの合成

現状コピペされている「認証 → 管理者 → 所有権 → ステータス」を、部品の積み重ねで宣言できる。ハンドラ本体はビジネスロジックだけになる。

```ts
app.get("/files",                requireAuth,                             listFiles);
app.post("/invitations",         requireAuth, requireAdmin,              createInvite);
app.delete("/files/:id",         requireAuth, requireFileOwner,          deleteFile);
app.get("/files/:id/download",   requireAuth, requireFileOwner, requireReady, download);
app.post("/files/:id/shares",    requireAuth, requireFileOwner, zValidator("json", createSchema), createShare);
app.delete("/shares/:id",        requireAuth, requireShareOwner,         revokeShare);
app.get("/s/:token",             requireAuth,                             shareMeta);
app.get("/s/:token/download",    requireAuth,                             shareDownload);
app.post("/register/:token",     zValidator("json", acceptSchema),       register); // 未ログイン
```

#### 型付きコンテキストでリソースを後段へ渡す

`requireFileOwner` がDBからファイルを引いて404/403を判定し、結果を `c.set` で後続へ渡す。これで `loadOwnedFile` の重複（download/delete/shares）が**1箇所**に集約され、後続ミドルウェア/ハンドラは引き直し不要。

```ts
// 型定義: ミドルウェアが set する値に型を付ける
type Env = { Variables: { session: Session; file: File } };
const app = new Hono<Env>().basePath("/api");

const requireFileOwner = createMiddleware<Env>(async (c, next) => {
  const session = c.get("session"); // requireAuth が前段で set 済み
  const file = await prisma.file.findUnique({ where: { id: c.req.param("id") } });
  if (!file) return c.json({ error: "not found" }, 404);
  if (file.ownerId !== session.user.id && !isAdmin(session)) {
    return c.json({ error: "forbidden" }, 403);
  }
  c.set("file", file);
  await next();
});

const requireReady = createMiddleware<Env>(async (c, next) => {
  const file = c.get("file");
  if (file.status === "DELETED" || file.status === "EXPIRED") return c.json({ error: "not found" }, 404);
  if (file.status !== "READY") return c.json({ error: "file not ready", status: file.status }, 409);
  await next();
});

// ハンドラはロジックだけ
const download = async (c: Context<Env>) => {
  const { file } = c.var;
  await writeAudit({ userId: c.var.session.user.id, action: "FILE_DOWNLOADED", targetType: "file", targetId: file.id, result: "ok" });
  return buildDownloadResponse(file.storagePath, file.originalName, file.mimeType, c.req.header("range") ?? null);
};
```

#### パス単位の一括適用とエラー集約

```ts
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal error" }, 500); // register 等の散在 try/catch を集約
});

// 例: ファイル操作系だけにアクセスログ／将来のレート制限を後付け
app.use("/files/*", auditAccess);
app.use("/s/:token/download", rateLimit({ /* ... */ }));
```

#### Hono を使わない場合の同等表現（比較）

機能的には高階関数でも実現できる。Hono の優位は「合成の宣言性・`c.var` の型の流れ・`onError`/`app.use` の標準機構」であって唯一の手段ではない。判断材料として併記する。

```ts
// 軽量ラッパー版（推奨1で採用する形）
export const GET = withAuth(withFileOwner(withReady(async ({ session, file, req }) => {
  await writeAudit(/* ... */);
  return buildDownloadResponse(file.storagePath, file.originalName, file.mimeType, req.headers.get("range"));
})));
```

ネストが深くなると可読性で Hono の横並び宣言に劣る。**関心事の数が増えるほど Hono が有利**になる、というのが移行判断の分岐点。

## 6. 案B: server.ts 直結（不採用）

`@hono/node-server` で tus と並べて `/api/*` を Next バイパスで処理する案。
最速だが `auth()` が使えず全面 `getToken()` 化が必要、NextAuth との統合が広範に崩れるため**不採用**。

## 7. 移行手順（案Aを採る場合）

1. PoC: catch-all に `/api/files` GET のみ Hono で実装し、`auth()`・ルート優先順位・型を確認。
2. 読み取り系（`/api/s/*`, `/api/files`）から移行。
3. 変更系（`shares`, `invitations`, `register`, delete）を `zValidator` 付きで移行。
4. ダウンロード系（Range）を移行し、実機で大容量DLを確認。
5. 旧 `route.ts` を削除。`docs/design.md` の「API（Route Handlers）」記述を更新。

> 注意: 本リポジトリはランタイム/テスト環境ではない。検証は `npm run typecheck` / `npm run lint` のみ。実機動作確認は本番系で行う。

## 8. 残課題（本検討と独立）

- `/api/files` のページネーション（現状 `take:1000` の安全弁のみ）。
- エラーレスポンス形状の統一（`{ error: string }` と `{ error, reason }` が混在）。
- 共通の監査ログ記録ヘルパ化。
