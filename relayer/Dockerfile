# Relayer image: build from the repo root so the shared SDK in app/src/lib/royale is included.
#   docker build -f relayer/Dockerfile -t royale-relayer .
#   docker run --env-file relayer/.env -v ~/.config/solana/royale-mainnet-relayer.json:/keys/relayer.json:ro \
#     -e RELAYER_KEYPAIR=/keys/relayer.json -p 8787:8787 royale-relayer
FROM node:22-slim
WORKDIR /repo
COPY package.json package-lock.json ./
COPY app/package.json app/package.json
COPY relayer/package.json relayer/package.json
RUN npm ci --workspaces --include-workspace-root --ignore-scripts
COPY app/src/lib app/src/lib
COPY app/src/idl app/src/idl
COPY relayer relayer
EXPOSE 8787
CMD ["npx", "tsx", "relayer/src/index.ts"]
