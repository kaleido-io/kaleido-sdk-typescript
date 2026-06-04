# Build from the sample directory: docker build -t multi-snippet-provider:latest .
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Runtime stage — distroless for minimal attack surface and image size
FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# Bake in snippets and configs so the image is self-contained for CI validation.
# In production, inject snippets and manifest via a platform-managed mechanism (TBD).
COPY snippets ./snippets
COPY config ./config

# Platform config (IndexerConfig shape): WFE URL, AM, auth, providerName, env IDs.
ENV KALEIDO_CONFIG_FILE=./config/config.yaml

# Snippet manifest (SnippetManifest shape): list of snippet names + paths.
ENV CONFIG_FILE=./config/manifest.yaml

# distroless/nodejs images run as nonroot (uid 65532) by default
USER nonroot

# Pass --validate to perform a structural check (no WFE connection).
# Omit to run the full provider: load → init → register → connect.
CMD ["dist/src/main.js"]
