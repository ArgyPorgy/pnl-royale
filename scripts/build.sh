#!/usr/bin/env bash
# Build the royale program (SBF) and its IDL with the pinned toolchain (Agave 3.1.9, Anchor 1.0.2).
set -euo pipefail
cd "$(dirname "$0")/.."
AGAVE="${AGAVE_BIN:-$HOME/.local/share/solana/install/releases/3.1.9/solana-release/bin}"
ANCHOR="${ANCHOR_BIN:-$HOME/.avm/bin/anchor-1.0.2}"
export PATH="$AGAVE:$PATH"
(cd programs/royale && cargo build-sbf --sbf-out-dir ../../target/deploy)
mkdir -p target/idl target/types
RUSTUP_TOOLCHAIN=1.96.0 "$ANCHOR" idl build -p royale -o target/idl/royale.json -t target/types/royale.ts
# keep copies for the app and relayer
mkdir -p app/src/idl relayer/src/idl
cp target/idl/royale.json app/src/idl/royale.json
cp target/types/royale.ts app/src/idl/royale.ts
cp target/idl/royale.json relayer/src/idl/royale.json
cp target/types/royale.ts relayer/src/idl/royale.ts
ls -la target/deploy/royale.so
