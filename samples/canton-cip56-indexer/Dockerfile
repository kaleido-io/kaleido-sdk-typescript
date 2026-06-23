# Build stage — full Node image for tsc
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src

RUN npm run build

# Runtime stage — distroless for minimal attack surface and image size
# No shell, no package manager: only the Node runtime and your compiled JS.
FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

# Copy compiled output, production node_modules, and config
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY config ./config

ENV CONFIG_FILE=./config/provider-config.yaml

# distroless node images use nonroot (uid 65532) by default
USER nonroot

CMD ["dist/src/connect.js"]
