/** @type {import('next').NextConfig} */
const nextConfig = {
  // カスタムサーバ(server.ts)で起動するため standalone 出力は使わない
  // tus / 大容量配信はカスタムサーバ側で扱う
  serverExternalPackages: ["@node-rs/argon2", "@tus/server", "@tus/file-store"],
  experimental: {
    // App Router の Server Actions で大きめのボディを許容（通常APIはtus経由）
    serverActions: { bodySizeLimit: "2mb" },
  },
};

export default nextConfig;
