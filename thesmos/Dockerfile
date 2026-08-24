# syntax=docker/dockerfile:1
#
# Builds the thesmos-governance CLI / MCP server as a portable container.
# This is an npm-workspaces monorepo, so the build context must be the repo
# ROOT (where package-lock.json actually lives), not this directory:
#   docker build -f thesmos/Dockerfile -t thesmos-governance .
#
# Run against a mounted project:
#   docker run --rm -v "$PWD":/workspace thesmos-governance validate
#
# Run as an MCP server over stdio (needs -i for stdin/stdout piping):
#   docker run --rm -i -v "$PWD":/workspace thesmos-governance mcp:serve

ARG NODE_VERSION=22
ARG NODE_ENV=production

FROM node:${NODE_VERSION}-alpine AS builder
WORKDIR /build

# Copy only dependency manifests first for better layer caching
COPY package.json package-lock.json ./
COPY thesmos/package.json thesmos/package.json
COPY actions/pr-review/package.json actions/pr-review/package.json
COPY extensions/vscode/package.json extensions/vscode/package.json

# Install dependencies (keep dev deps for build)
RUN npm ci --workspace=thesmos --include-workspace-root

# Copy source code after dependencies are cached
COPY thesmos ./thesmos

# Build application
RUN npm run build --workspace=thesmos && \
    rm -rf thesmos/src thesmos/test thesmos/*.test.ts thesmos/coverage

FROM node:${NODE_VERSION}-alpine AS runtime

# Set security labels and metadata
LABEL org.opencontainers.image.title="Thesmos Governance" \
      org.opencontainers.image.description="CLI / MCP server for thesmos-governance"

ENV NODE_ENV=${NODE_ENV} \
    NODE_OPTIONS="--enable-source-maps"

# Create non-root user for security
RUN addgroup -S thesmos && adduser -S thesmos -G thesmos

WORKDIR /workspace

# Copy only built artifacts and production package.json
COPY --from=builder --chown=thesmos:thesmos /build/thesmos/dist /opt/thesmos/dist
COPY --from=builder --chown=thesmos:thesmos /build/thesmos/package.json /opt/thesmos/package.json

# Make executables executable
RUN chmod +x /opt/thesmos/dist/cli.js /opt/thesmos/dist/thesmos-guard.js

USER thesmos

ENTRYPOINT ["node", "/opt/thesmos/dist/cli.js"]
CMD ["--help"]
