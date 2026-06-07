import { createServer } from "node:http";
import next from "next";
import { createTusServer, TUS_PATH } from "./lib/tus";

const dev = process.env.NODE_ENV !== "production";
const hostname = "0.0.0.0";
const port = Number(process.env.PORT ?? 3000);

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

async function main() {
  await app.prepare();
  const tus = await createTusServer();

  const server = createServer((req, res) => {
    // tus プロトコルは Next.js を介さずカスタムサーバで直接処理（大容量・再開対応）
    if (req.url && req.url.startsWith(TUS_PATH)) {
      tus.handle(req, res);
      return;
    }
    handle(req, res);
  });

  // 大容量の長時間アップロード/ダウンロードのためタイムアウトを延長
  server.requestTimeout = 0;
  server.headersTimeout = 0;

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (dev=${dev})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
