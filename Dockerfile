# syntax=docker/dockerfile:1.7
# NSUT Attendance & Presence — single image: API + built web app.

# ---------- build stage
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN npm ci --no-audit --no-fund
COPY tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN npm run build -w @nsut/web && npm run build -w @nsut/api

# ---------- runtime stage
FROM node:22-alpine AS runtime
ENV NODE_ENV=production \
    APP_ROOT=/app \
    PORT=4000
WORKDIR /app
RUN apk add --no-cache tini postgresql16-client
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
# Production dependencies of the API only (the web app ships as static files).
RUN npm ci --omit=dev --no-audit --no-fund -w @nsut/api --include-workspace-root=false && npm cache clean --force
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/web/dist ./apps/web/dist
COPY database ./database
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 CMD wget -qO- http://127.0.0.1:4000/health || exit 1
ENTRYPOINT ["/sbin/tini", "--", "entrypoint.sh"]
CMD ["node", "apps/api/dist/server.js"]
