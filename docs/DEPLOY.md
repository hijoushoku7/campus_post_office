# 起動手順書（デプロイ用）

別サーバー（自宅サーバー）で **Campus Post Office** を Docker で起動するための手順です。
この1ファイルだけ見れば起動・運用できるようにまとめています。

---

## 0. 事前準備（前提条件）

サーバー側に以下が必要です。

| 項目 | 要件 / 備考 |
|------|------------|
| OS | Linux 推奨（Docker が動けば可） |
| Docker | Docker Engine 24+ |
| Docker Compose | v2（`docker compose` コマンド） |
| メモリ | **最低 4GB 以上**（ClamAV がシグネチャDBで 2〜3GB 常駐するため） |
| ディスク | 共有ファイルの合計容量＋余裕（例: 100GB〜） |
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

> その他（保存容量・期限・ClamAV接続先など）は既定値のままで動きます。
> 必要に応じて `MAX_FILE_SIZE`（既定10GB）、`DEFAULT_EXPIRY_DAYS`（既定7日）、
> `MIN_FREE_SPACE`（既定20GB）を調整してください。

---

## 4. ビルド & 起動

```bash
docker compose up -d --build
```

- 初回はイメージビルド（数分）に加え、**ClamAV のシグネチャDBダウンロードに数分**かかります。
- DL完了までウイルススキャンは待機・自動リトライされます（アップロード自体は可能）。

状態確認:

```bash
docker compose ps
docker compose logs -f clamav   # "Self checking every ..." 等が出ればDB準備OK
```

---

## 5. データベース初期化 & 管理者作成

コンテナ起動後、一度だけ実行します。

```bash
# スキーマをDBへ反映
docker compose run --rm app npx prisma db push

# 初期管理者アカウントを作成（.env の SEED_ADMIN_* を使用）
docker compose run --rm app npm run seed
```

> 本番でスキーマを継続的に管理したい場合は `prisma migrate`（マイグレーション）への移行を推奨します。

---

## 6. 動作確認

1. ブラウザで `PUBLIC_BASE_URL`（例 `https://files.example.com`）を開く
2. 手順3の管理者メール／パスワードでログイン
3. 「マイファイル」でテストファイルをアップロード
   - 進捗が表示され、完了後に「チェック中」→（数十秒〜）「利用可能」に変われば成功
4. 「共有リンク」を作成し、別アカウント（または同一）でリンクを開いてダウンロード確認
5. `/admin`（管理）で統計・操作ログが表示されることを確認

チェックリスト:

- [ ] HTTPS でアクセスできる（Cloudflare 経由）
- [ ] ログインできる
- [ ] アップロード→「利用可能」になる（= ClamAV 連携OK）
- [ ] ダウンロードできる
- [ ] 共有リンクがログイン必須で機能する

---

## 7. 運用コマンド

```bash
# ログ確認
docker compose logs -f app
docker compose logs -f worker     # スキャン/期限削除の動作
docker compose logs -f cloudflared

# 再起動 / 停止
docker compose restart app
docker compose down               # 全停止（ボリュームは保持）

# 起動（再開）
docker compose up -d
```

### アップデート（コード更新時）

```bash
git pull                          # 新しいコードを取得
docker compose up -d --build      # 再ビルドして反映
# スキーマ変更があった場合のみ:
docker compose run --rm app npx prisma db push
```

### バックアップ（DB）

ファイル本体は短期（7日で自動削除）のため任意ですが、**DB は定期バックアップ推奨**です。

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

---

## 8. トラブルシューティング

| 症状 | 原因 / 対処 |
|------|------------|
| アップロードが途中で `413` で失敗 | Cloudflare の 1リクエスト 100MB 上限。本アプリは50MBチャンクで回避済み。プランで上限を変更していないか確認 |
| アップロードはできるが「チェック中」のまま | ClamAV のDB準備が未完 or 接続不可。`docker compose logs clamav` を確認。初回は数分待つ |
| `INFECTED`/「ブロック」になる | ウイルス検出 → 自動削除済み。`/admin` の感染検出履歴を確認 |
| 4GB超の巨大ファイルが正常でもブロック気味 | ClamAV のスキャン上限（約4GB）。`docker/clamav/clamd.conf` 参照。超過部分は未スキャン扱い |
| サイトに繋がらない | `docker compose logs cloudflared` でトンネル接続を確認。Public Hostname の URL が `app:3000` か確認 |
| ログインできない | `AUTH_SECRET` 未設定/変更、または seed 未実行。手順3・5を確認 |
| メモリ不足で落ちる | ClamAV が重い。サーバーのRAMを増やすか、用途次第でスキャン方針の見直しを検討 |

---

## 9. 構成のおさらい

| サービス | 役割 |
|----------|------|
| `app` | Next.js + tus（UI / API / アップロード） |
| `worker` | ウイルススキャン・期限切れ自動削除 |
| `postgres` | メタデータ・共有リンク・操作ログ |
| `redis` | ジョブキュー |
| `clamav` | ウイルススキャン本体 |
| `cloudflared` | Cloudflare Tunnel（公開） |

データは Docker ボリューム（`pg_data` / `redis_data` / `clamav_db` / `uploads_data`）に保存されます。
`docker compose down` では消えません（`down -v` を付けると消えるので注意）。
