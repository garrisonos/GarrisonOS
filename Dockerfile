# ==============================================================================
# GarrisonOS Production Dockerfile
# Zero-Dependency, Multi-Stage, Minimal Attack Surface Image
# ==============================================================================

# --- Stage 1: Build & Compilation ---
FROM node:24-alpine AS builder

WORKDIR /build

# Copy build manifests
COPY package.json tsconfig.json ./

# Install permitted build-time TypeScript compiler and type declarations
RUN npm install --ignore-scripts

# Copy source tree
COPY api/ ./api/
COPY core/ ./core/
COPY database/ ./database/
COPY modules/ ./modules/
COPY web/ ./web/
COPY test/ ./test/

# Compile TypeScript to dist/
RUN npm run build

# --- Stage 2: Production Runtime ---
FROM node:24-alpine AS runner

LABEL maintainer="GarrisonOS Contributors <contributors@garrisonos.org>"
LABEL org.opencontainers.image.title="GarrisonOS"
LABEL org.opencontainers.image.description="Zero-dependency open-source real estate property management engine"
LABEL org.opencontainers.image.licenses="LicenseRef-GarrisonOS-Fair-Code-1.0 OR AGPL-3.0-or-later"

WORKDIR /app

# Create unprivileged system user and group
RUN addgroup -g 10001 -S garrison && \
    adduser -u 10001 -S garrison -G garrison -s /sbin/nologin

# Create writable data and persistent storage directories
RUN mkdir -p /app/data /app/storage && \
    chown -R garrison:garrison /app

# Copy compiled artifacts and production assets from builder
COPY --from=builder --chown=garrison:garrison /build/dist /app/dist
COPY --from=builder --chown=garrison:garrison /build/package.json /app/package.json

# Copy runtime scripts, web assets, and database migrations
COPY --chown=garrison:garrison scripts/ /app/scripts/
COPY --chown=garrison:garrison web/public/ /app/web/public/
COPY --chown=garrison:garrison database/migrations/ /app/database/migrations/
COPY --chown=garrison:garrison modules/ /app/modules/
COPY --chown=garrison:garrison VERSION /app/VERSION

# Production Environment Defaults
ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    WEB_PORT=8080 \
    WEB_HOST=0.0.0.0 \
    SQLITE_PATH=/app/data/garrison.sqlite \
    STORAGE_PATH=/app/storage

# Expose API (3000) and Web Presentation (8080) ports
EXPOSE 3000 8080

# Declare persistent volumes
VOLUME ["/app/data", "/app/storage"]

# Drop to unprivileged user
USER garrison

# Native zero-dependency health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "const http = require('node:http'); http.get('http://127.0.0.1:3000/health', (res) => process.exit(res.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1));"

# Start unified Node.js engine and presentation server
ENTRYPOINT ["node"]
CMD ["scripts/serve.js"]
