# syntax=docker/dockerfile:1
# Container for brand-prompt-compare (Next.js 16 + better-sqlite3).
#
# Runs `next dev`, intentionally. This app is dev-grade (not production-build clean — it
# opens SQLite at module load, which breaks `next build`'s parallel page-data collection)
# and is slated for a local rebuild. Dev mode matches its known-working behavior and avoids
# build-time typecheck/DB issues while still giving us a reproducible, restart-policied,
# auto-starting service on :3000. Switch to a multi-stage prod build once the app is rebuilt.
FROM node:22-bookworm-slim
WORKDIR /app
# Toolchain for the better-sqlite3 native module.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
    && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
EXPOSE 3000
# Bind to 0.0.0.0 so the published port is reachable from the host.
CMD ["npx", "next", "dev", "-H", "0.0.0.0", "-p", "3000"]
