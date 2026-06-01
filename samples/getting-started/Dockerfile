# Build from project root: docker build -t getting-started-provider:latest .
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
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
COPY config ./config

ENV WFE_CONFIG_FILE=./config/wfe-config.yaml
ENV CONFIG_FILE=./config/config.yaml

# distroless/nodejs images run as nonroot (uid 65532) by default
USER nonroot

CMD ["dist/src/connect.js"]
