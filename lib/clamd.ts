import net from "node:net";
import { config } from "./config";

export type ScanResult =
  | { clean: true }
  | { clean: false; signature: string };

/**
 * clamd にパス指定スキャン(zSCAN)を依頼する。
 * clamav コンテナはアップロードボリュームを同一パスで共有マウントしている前提。
 * INSTREAM は StreamMaxLength の制約があり大容量に不向きなため使用しない。
 *
 * 注意: ClamAV はファイルサイズ上限 (MaxFileSize/MaxScanSize, 最大約4GB) があるため、
 * これを超えるファイルは clamd.conf の設定値まで・あるいは全くスキャンされない場合がある。
 */
export function scanPath(absPath: string, timeoutMs = 30 * 60 * 1000): Promise<ScanResult> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(config.clamav.port, config.clamav.host);
    let buf = "";

    socket.setTimeout(timeoutMs);

    socket.on("connect", () => {
      // zSCAN: NUL 終端コマンド
      socket.write(`zSCAN ${absPath}\0`);
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString("utf8");
    });

    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("clamd scan timed out"));
    });

    socket.on("error", (err) => reject(err));

    socket.on("end", () => {
      const line = buf.replace(/\0/g, "").trim();
      // 例: "/data/uploads/abc: OK"
      //     "/data/uploads/abc: Eicar-Test-Signature FOUND"
      //     "/data/uploads/abc: <error> ERROR"
      if (line.endsWith("OK")) {
        resolve({ clean: true });
      } else if (line.endsWith("FOUND")) {
        const m = line.match(/:\s*(.+)\s+FOUND$/);
        resolve({ clean: false, signature: m?.[1] ?? "unknown" });
      } else {
        reject(new Error(`clamd error: ${line}`));
      }
    });
  });
}

/** clamd の生存確認 (PING/PONG) */
export function ping(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(config.clamav.port, config.clamav.host);
    let buf = "";
    socket.setTimeout(5000);
    socket.on("connect", () => socket.write("zPING\0"));
    socket.on("data", (c) => (buf += c.toString()));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => resolve(false));
    socket.on("end", () => resolve(buf.replace(/\0/g, "").trim() === "PONG"));
  });
}
