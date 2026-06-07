// 環境変数の集約・型付け

function int(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  publicBaseUrl: process.env.PUBLIC_BASE_URL ?? "http://localhost:3000",
  uploadDir: process.env.UPLOAD_DIR ?? "/data/uploads",
  maxFileSize: int("MAX_FILE_SIZE", 10 * 1024 * 1024 * 1024), // 10GB
  defaultExpiryDays: int("DEFAULT_EXPIRY_DAYS", 7),
  uploadChunkSize: int("UPLOAD_CHUNK_SIZE", 50 * 1024 * 1024), // 50MB
  minFreeSpace: int("MIN_FREE_SPACE", 20 * 1024 * 1024 * 1024), // 20GB
  redisUrl: process.env.REDIS_URL ?? "redis://redis:6379",
  clamav: {
    host: process.env.CLAMAV_HOST ?? "clamav",
    port: int("CLAMAV_PORT", 3310),
  },
} as const;

export function expiryFromNow(days = config.defaultExpiryDays): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}
