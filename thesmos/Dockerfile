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

FROM node:22-alpine AS builder
WORKDIR /build
COPY package.json package-lock.json ./
COPY thesmos/package.json thesmos/package.json
COPY actions/pr-review/package.json actions/pr-review/package.json
COPY extensions/vscode/package.json extensions/vscode/package.json
RUN npm ci --workspace=thesmos --include-workspace-root
COPY thesmos ./thesmos
RUN npm run build --workspace=thesmos

FROM node:22-alpine AS runtime
RUN addgroup -S thesmos && adduser -S thesmos -G thesmos
WORKDIR /workspace
COPY --from=builder /build/thesmos/dist /opt/thesmos/dist
COPY --from=builder /build/thesmos/package.json /opt/thesmos/package.json
RUN chmod +x /opt/thesmos/dist/cli.js /opt/thesmos/dist/thesmos-guard.js
USER thesmos
ENTRYPOINT ["node", "/opt/thesmos/dist/cli.js"]
CMD ["--help"]
