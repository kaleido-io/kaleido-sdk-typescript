# Build from sample directory: docker build -t simple-provider-typescript:latest .
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json ./

# Remove monorepo workspace dep and install the published SDK from npm.
# Drop this step once the project lives in its own repo with a lockfile.
RUN apt-get update && apt-get install -y jq && \
  jq 'del(.dependencies["@kaleido-io/workflow-engine-sdk"])' package.json > tmp.json && mv tmp.json package.json && \
  npm i --save "@kaleido-io/workflow-engine-sdk" && \
  npm i --include=dev

COPY tsconfig.json ./
COPY connect.ts provider.ts handlers-config.ts register-handlers.ts ./
COPY handlers ./handlers
RUN npm run build

# Runtime stage — distroless for minimal attack surface and image size
FROM gcr.io/distroless/nodejs22-debian12

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY config ./config

ENV KALEIDO_CONFIG_FILE=./config/config.yaml
ENV CONFIG_FILE=./config/provider-config.yaml

# distroless/nodejs images run as nonroot (uid 65532) by default
USER nonroot

CMD ["--experimental-strip-types", "dist/connect.js"]
