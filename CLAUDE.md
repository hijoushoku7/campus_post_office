# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Campus Post Office is a self-hosted secure file-sharing app for a private/internal group. It runs on a home server via Docker and is exposed through Cloudflare Tunnel. Stack: TypeScript / Next.js 15 (App Router) / Auth.js v5 (Credentials + JWT) / Prisma + PostgreSQL / tus (resumable upload) / BullMQ + Redis / ClamAV.

README.md (Japanese) is the canonical setup/ops doc; `docs/requirements.md` and `docs/design.md` hold the detailed design.

**This environment is not a runtime/test environment.** The server runs in a separate production environment; do not start, run, or test the app (or its containers) here. Verify changes with `typecheck` and `lint` only — do not attempt to launch `server.ts`, the worker, or `docker compose` in this workspace.

## Commands

```bash
npm run dev          # app: custom server (tsx watch server.ts) — Next.js + tus together
npm run worker:dev   # worker: BullMQ scan/cleanup (tsx watch worker/index.ts)
npm run build        # next build
npm run start        # production app (NODE_ENV=production tsx server.ts)
npm run worker       # production worker
npm run lint         # next lint
npm run typecheck    # tsc --noEmit
npm run prisma:generate
npm run prisma:migrate   # dev migration
npm run prisma:deploy    # prod migration (migrate deploy)
npm run seed             # create initial admin from SEED_ADMIN_* env
npm run diag:files [email]   # diagnose empty /files & owner-mismatch (orphan) issues
```

There is no test framework in this repo; `typecheck` + `lint` are the verification gates.

Local dev expects infra in Docker: `docker compose up -d postgres redis clamav`, then run `npm run dev` and `npm run worker:dev` in separate terminals.

## Architecture — the parts that span multiple files

### Custom server: `/api/upload` bypasses Next.js entirely
`server.ts` is a single Node HTTP server that mounts BOTH Next.js and the tus server in one process. Requests to `/api/upload*` are routed to the tus handler ([lib/tus.ts](lib/tus.ts)); everything else goes to Next.js. Consequences:
- **You must run the app via `npm run dev` / `npm run start` (which run `server.ts`), never bare `next dev`** — otherwise `/api/upload` returns 404 and uploads silently break.
- The client ([components/Uploader.tsx](components/Uploader.tsx)) uses `tus-js-client` with 50MB chunks (Cloudflare's 100MB/request limit). Upload metadata (`filename`, `filetype`, `expiryDays`) is untrusted and re-validated/clamped server-side.

### Auth is split into two NextAuth instances (Edge vs Node)
- [lib/auth.config.ts](lib/auth.config.ts) must stay **Edge-safe** (no Prisma, no argon2). [middleware.ts](middleware.ts) instantiates NextAuth with only this config to protect routes at the edge.
- [lib/auth.ts](lib/auth.ts) is the full Node instance (Prisma + `@node-rs/argon2`) used by API routes and server actions.
- Sessions are **JWT, no `Session` table** in Prisma. `middleware.ts` excludes `/api/upload` from its matcher because the custom tus server does its own auth via `getToken()`.

### tus upload auth re-verifies the user against the DB
Because JWTs outlive the DB user (e.g. after a reseed the cookie is still signed-valid but `User.id` changed), [lib/tus.ts](lib/tus.ts) re-checks the owner exists in `onUploadCreate` AND `onUploadFinish` to avoid FK violations. A valid cookie for a missing/inactive user → 401 "セッションが無効です". This produces "orphan" files; `npm run diag:files` detects them and the fix is log out / log back in.

### File lifecycle (status machine on the `File` model)
`UPLOADING` → (tus finish creates the row) `SCANNING` → worker scan → `READY` or `INFECTED` (infected file is deleted from disk). Cleanup worker flips expired files to `EXPIRED`. UI/API queries filter `status notIn [DELETED, EXPIRED]`. Status enum lives in [prisma/schema.prisma](prisma/schema.prisma).

### Worker = two BullMQ queues
[worker/index.ts](worker/index.ts) runs a `scan` worker (ClamAV path-scan via [lib/clamd.ts](lib/clamd.ts), concurrency 2) and a `cleanup` worker (repeatable job every 10 min that expires/deletes files). Queues/connection are defined in [lib/queue.ts](lib/queue.ts); `enqueueScan` is called from tus on upload finish.

### Container topology & shared volume
Single image [docker/Dockerfile.app](docker/Dockerfile.app) is used by both `app` (`server.ts`) and `worker` (`command: npm run worker`). `app`, `worker`, and `clamav` all mount the **same `uploads_data` volume at `/data/uploads`** — ClamAV scans by path, so the upload directory must be identical across containers. `cloudflared` fronts `app:3000`. Note `app` publishes no host port; in production it's only reachable through the tunnel.

### Config
All tunables go through [lib/config.ts](lib/config.ts) (typed env wrapper): `maxFileSize` (10GiB hard maximum), `minFreeSpace` (20GB — uploads rejected below this), `defaultExpiryDays`/`maxExpiryDays`, ClamAV/Redis endpoints. Prefer adding env-backed values here over reading `process.env` directly.
