# 起動手順書（デプロイ用）

別サーバー（自宅サーバー）で **Campus Post Office** を Docker で起動するための手順です。
この1ファイルだけ見れば起動・運用できるようにまとめています。
内部の動作仕様を知りたい場合は [logic.md](./logic.md) を参照してください。

---

## 0. 事前準備（前提条件）

サーバー側に以下が必要です。

| 項目 | 要件 / 備考 |
|------|------------|
| OS | Linux 推奨（Docker が動けば可） |
| Docker | Docker Engine 24+ |
| Docker Compose | v2（`docker compose` コマンド） |
| メモリ | **最低 4GB 以上**（ClamAV がシグネチャDBで 2〜3GB 常駐するため） |
| ディスク | 共有ファイルの合計容量＋余裕（例: 100GB〜）。空きが `MIN_FREE_SPACE`（既定20GB）を切るとアップロードを拒否 |
| ドメイン | **Cloudflare にネームサーバーを預けた独自ドメイン**（Tunnel に必須） |
| ネット | ビルド時に外部（npm / フォント / ClamAV DB）へ接続できること |

確認コマンド:

```bash
docker --version
docker compose version
free -h        # メモリ確認
df -h          # ディスク確認
```

---

## 1. ソースをサーバーへ配置

開発機のプロジェクト一式をサーバーへコピーします（git or rsync or scp）。

```bash
# 例: git の場合
git clone <リポジトリURL> campus_post_office
cd campus_post_office

# 例: ローカルからコピーする場合（開発機で実行）
# rsync -av --exclude node_modules --exclude .next ./ user@server:/opt/campus_post_office/
```

> `node_modules` や `.next` は転送不要です（コンテナビルド時に生成されます）。

---

## 2. Cloudflare Tunnel を作成（ダッシュボード）

1. Cloudflare Zero Trust → **Networks → Tunnels** → **Create a tunnel**
2. **Cloudflared** を選択し、トンネル名を入力（例: `campus-post-office`）
3. 表示される **トークン**（`eyJ...` の長い文字列）を控える → `.env` の `TUNNEL_TOKEN` に使用
4. **Public Hostname** を追加:
   - Subdomain/Domain: 公開したいURL（例: `sharefile.hijoushoku.com`）
   - Type: **HTTP**
   - URL: **`app:3000`** ← compose 内のサービス名で指定
5. 保存

> ⚠️ Type は HTTPS ではなく **HTTP** を指定します（コンテナ間は平文、TLS は Cloudflare エッジが終端）。
> `app` はホストにポートを公開しません。**到達経路はトンネルのみ**です。

---

## 3. 環境変数を設定

```bash
cp .env.example .env
```

`.env` を編集し、最低限以下を設定します。

```bash
# 公開URL（手順2で設定したホスト名）
PUBLIC_BASE_URL=https://files.example.com

# セッション署名鍵（必ず再生成）
AUTH_SECRET=<`openssl rand -base64 32` の出力>
AUTH_TRUST_HOST=true

# DB（パスワードを強固なものに。DATABASE_URL と一致させる）
POSTGRES_USER=app
POSTGRES_PASSWORD=<強いパスワード>
POSTGRES_DB=campus_post_office
DATABASE_URL=postgresql://app:<同じパスワード>@postgres:5432/campus_post_office?schema=public

# Cloudflare Tunnel トークン（手順2で控えたもの）
TUNNEL_TOKEN=<eyJ... のトークン>

# 初期管理者（手順5で作成される）
SEED_ADMIN_EMAIL=admin@example.com
SEED_ADMIN_PASSWORD=<強いパスワード>
```

鍵の生成例:

```bash
openssl rand -base64 32      # AUTH_SECRET 用
```

> その他は既定値で動きます。必要に応じて調整してください（既定値は [logic.md §9](./logic.md#9-設定値-libconfigts) に一覧）。
>
> | 環境変数 | 既定 | 用途 |
> |---|---|---|
> | `MAX_FILE_SIZE` | 10GiB | 1ファイル上限 |
> | `DEFAULT_EXPIRY_DAYS` / `MAX_EXPIRY_DAYS` | 7 / 30 | 保管期限（既定 / ユーザー指定上限） |
> | `MIN_FREE_SPACE` | 20GB | これを下回るとアップロード拒否 |
> | `INVITE_EXPIRY_HOURS` | 48 | 招待リンクの有効期限 |
> | `STALE_UPLOAD_HOURS` | 24 | 未完了アップロードの残骸を掃除するまでの時間 |
> | `AUDIT_RETENTION_DAYS` | 90 | 監査ログの保持日数（超過分は自動削除） |

---

## 4. ビルド & 起動

```bash
docker compose up -d --build
```

起動するサービス: `app` / `worker` / `postgres` / `redis` / `clamav` / `cloudflared`。

- 初回はイメージビルド（数分）に加え、**ClamAV のシグネチャDBダウンロードに数分**かかります。
- DL完了までウイルススキャンは待機・自動リトライされます（アップロード自体は可能）。

状態確認:

```bash
docker compose ps
docker compose logs -f clamav   # "Self checking every ..." 等が出ればDB準備OK
```

---

## 5. データベース初期化 & 管理者作成

コンテナ起動後、一度だけ実行します。**`prisma db push` 方式**で、現在の `schema.prisma` を直接DBへ反映します。

```bash
# スキーマをDBへ反映（schema.prisma の内容をそのままDBへ反映）
docker compose run --rm app npx prisma db push

# 初期管理者アカウントを作成（.env の SEED_ADMIN_* を使用）
docker compose run --rm app npm run seed
```

> このプロジェクトは `prisma/migrations`（マイグレーション履歴）を持たないため、
> `prisma migrate deploy` ではテーブルが作られません（`No migration found` で何もせず終了）。
> 代わりに `prisma db push` で `schema.prisma` を直接DBへ反映します。
> スキーマを変更した場合も、同じく `prisma db push` を再実行して反映してください。

---

## 6. 動作確認

1. ブラウザで `PUBLIC_BASE_URL`（例 `https://files.example.com`）を開く
2. 手順3の管理者メール／パスワードでログイン
3. 「マイファイル」でテストファイルをアップロード
   - 進捗が表示され、完了後に「チェック中」→（数十秒〜）「利用可能」に変われば成功
   - アップロード中の「キャンセル」ボタンで中断・残骸削除されることも確認
4. 「共有リンク」を作成し、別アカウント（または同一）でリンクを開いてダウンロード確認
5. `/admin`（管理）で統計・感染履歴・操作ログが表示されることを確認

チェックリスト:

- [ ] HTTPS でアクセスできる（Cloudflare 経由）
- [ ] ログインできる
- [ ] アップロード→「利用可能」になる（= ClamAV 連携OK）
- [ ] ダウンロードできる（Range 対応のため一時停止・再開も可）
- [ ] 共有リンクがログイン必須で機能し、回数上限・期限が効く

---

## 7. 運用コマンド

```bash
# ログ確認
docker compose logs -f app
docker compose logs -f worker     # スキャン / 期限削除 / 残骸・監査ログ掃除（10分ごと）
docker compose logs -f cloudflared

# 再起動 / 停止
docker compose restart app
docker compose down               # 全停止（ボリュームは保持）

# 起動（再開）
docker compose up -d
```

> `worker` は10分ごとに「期限切れファイルの削除」「未完了アップロードの残骸掃除（`STALE_UPLOAD_HOURS`）」
> 「古い監査ログの剪定（`AUDIT_RETENTION_DAYS`）」をまとめて実行します。

### アップデート（コード更新時）

```bash
git pull                          # 新しいコードを取得
docker compose up -d --build      # 再ビルドして反映
# スキーマ（schema.prisma）に変更があった場合のみ:
docker compose run --rm app npx prisma db push
```

### バックアップ（DB）

ファイル本体は短期（既定7日で自動削除）のため任意ですが、**DB は定期バックアップ推奨**です。

```bash
# バックアップ
docker compose exec -T postgres pg_dump -U app campus_post_office > backup_$(date +%F).sql

# リストア
cat backup_YYYY-MM-DD.sql | docker compose exec -T postgres psql -U app -d campus_post_office
```

### ディスク監視

ローカルFS保存です。空きが `MIN_FREE_SPACE` を下回るとアップロードを拒否します。

```bash
df -h
docker system df                  # Docker のボリューム使用量
```

### ファイル取得トラブルの切り分け

`/files` や `/api/files` が空になる等の調査には診断スクリプトを使います（[scripts/README.md](../scripts/README.md)）。

```bash
docker compose exec app npm run diag:files                 # 全体サマリ
docker compose exec app npm run diag:files user@example.com # 特定ユーザー
```

---

## 8. トラブルシューティング

| 症状 | 原因 / 対処 |
|------|------------|
| アップロードが途中で `413` で失敗 | Cloudflare の 1リクエスト 100MB 上限。本アプリは50MBチャンクで回避済み。プランで上限を変更していないか確認 |
| アップロードが `507` で拒否される | サーバの空き容量が `MIN_FREE_SPACE`（既定20GB）を下回っている。`df -h` で確認し容量確保 |
| 画面更新でアップロードが消える / 残骸が溜まる | 未完了アップロードは `worker` が `STALE_UPLOAD_HOURS`（既定24h）経過後に自動削除。完了前のリロードは「キャンセル」推奨 |
| アップロードはできるが「チェック中」のまま | ClamAV のDB準備が未完 or 接続不可。`docker compose logs clamav` を確認。初回は数分待つ |
| `INFECTED`/「ブロック」になる | ウイルス検出 → 自動削除済み。`/admin` の感染検出履歴を確認 |
| 10GiB前後のファイルが `413` になる | アプリ側の上限。`MAX_FILE_SIZE` は10GiBを超えて設定できない |
| ログイン済みなのに突然弾かれる | ユーザー無効化（`isActive=false`）後、最長10分で JWT セッションが失効する仕様。意図通りなら正常 |
| 共有/ファイル一覧が空 + 「orphan」 | DB再作成・seed やり直しで `User.id` が変わったのに古い Cookie が残存。**ログアウト→再ログイン**で解消（`diag:files` で検出可） |
| サイトに繋がらない | `docker compose logs cloudflared` でトンネル接続を確認。Public Hostname の URL が `app:3000` か確認 |
| ログインできない | `AUTH_SECRET` 未設定/変更、または seed 未実行。手順3・5を確認 |
| `prisma db push` が FK 違反で失敗 | 過去データに削除済みユーザーを指す `ShareLink.createdById` 等がある場合。`DELETE FROM "ShareLink" WHERE "createdById" NOT IN (SELECT id FROM "User");` 等で不整合行を掃除してから再実行 |
| `No migration found in prisma/migrations` | このプロジェクトはマイグレーション履歴を持たない。`prisma migrate deploy` ではなく `npx prisma db push` を使う（手順5参照） |
| メモリ不足で落ちる | ClamAV が重い。サーバーのRAMを増やすか、用途次第でスキャン方針の見直しを検討 |

---

## 9. 構成のおさらい

| サービス | 役割 |
|----------|------|
| `app` | Next.js + tus（UI / API / アップロード）。`server.ts` で両者を1プロセス同居 |
| `worker` | ウイルススキャン・期限切れ削除・残骸/監査ログ掃除（同一イメージ、`npm run worker`） |
| `postgres` | メタデータ・共有リンク・操作ログ |
| `redis` | ジョブキュー（BullMQ） |
| `clamav` | ウイルススキャン本体（`uploads_data` を読み取り専用で共有マウント） |
| `cloudflared` | Cloudflare Tunnel（公開。`app:3000` をフロント） |

`app` / `worker` / `clamav` は **同じ `uploads_data` を `/data/uploads` にマウント**します
（ClamAV はパス指定スキャンのため、保存先パスが全コンテナで一致している必要があるため）。

データは Docker ボリューム（`pg_data` / `redis_data` / `clamav_db` / `uploads_data`）に保存されます。
`docker compose down` では消えません（`down -v` を付けると消えるので注意）。
