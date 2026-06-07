# アプリ(Next.js + tus カスタムサーバ)用イメージ。
# Worker サービスも同じイメージを使い、compose 側で command を上書きする。
FROM node:20-bookworm-slim

WORKDIR /app

# Prisma が必要とする openssl
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# 依存インストール（devDeps も使用: tsx でサーバ/worker を実行, prisma CLI）
COPY package.json package-lock.json* ./
RUN npm install

# ソース投入
COPY . .

# Prisma Client 生成 + Next.js ビルド
RUN npx prisma generate \
  && npm run build

# アップロード保存先（compose でボリュームをマウント）
RUN mkdir -p /data/uploads

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "run", "start"]
