export function formatBytes(bytes: number | bigint): string {
  const n = typeof bytes === "bigint" ? Number(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// 日時を「2026/06/10 14:30」形式で整形する（ロケール依存を避け決定的に）
export function formatDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  const y = d.getFullYear();
  const MM = pad(d.getMonth() + 1);
  const dd = pad(d.getDate());
  const HH = pad(d.getHours());
  const mm = pad(d.getMinutes());
  return `${y}/${MM}/${dd} ${HH}:${mm}`;
}

export function remainingTime(expiresAt: Date): string {
  const ms = expiresAt.getTime() - Date.now();
  if (ms <= 0) return "期限切れ";
  const hours = Math.floor(ms / (1000 * 60 * 60));
  if (hours >= 24) return `あと${Math.floor(hours / 24)}日`;
  return `あと${hours}時間`;
}
