#!/usr/bin/env bash
# Guarded mainnet deploy of the royale program, then init_config.
#
#   ADMIN_KEYPAIR=~/.config/solana/royale-mainnet-admin.json \
#   L1_RPC=https://mainnet.helius-rpc.com/?api-key=KEY \
#   FEE_VAULT_OWNER=<your main wallet> \
#   CONFIRM=deploy ./scripts/deploy-mainnet.sh
#
# Spends real SOL: ~3.86 SOL is locked as program-data rent (recoverable with
# `solana program close` if the program is ever retired), plus ~0.01-0.03 SOL of fees.
# Resumable: the write buffer keypair is saved, so a rate-limited run can simply be re-run.
set -euo pipefail
cd "$(dirname "$0")/.."

AGAVE="${AGAVE_BIN:-$HOME/.local/share/solana/install/releases/3.1.9/solana-release/bin}"
export PATH="$AGAVE:$PATH"
ADMIN_KEYPAIR="${ADMIN_KEYPAIR:?set ADMIN_KEYPAIR (deployer = upgrade authority = config admin)}"
PROGRAM_KEYPAIR="${PROGRAM_KEYPAIR:-target/deploy/royale-keypair.json}"
BUFFER_KEYPAIR="${BUFFER_KEYPAIR:-$HOME/.config/solana/royale-mainnet-buffer.json}"
L1_RPC="${L1_RPC:-https://api.mainnet-beta.solana.com}"
PRIORITY="${PRIORITY_MICROLAMPORTS:-50000}"
MAX_LEN="${MAX_LEN:-760000}"

export NEXT_PUBLIC_CLUSTER=mainnet
export NEXT_PUBLIC_L1_RPC="$L1_RPC"
export NEXT_PUBLIC_ER_RPC="${NEXT_PUBLIC_ER_RPC:-https://mainnet-tee.magicblock.app}"
export NEXT_PUBLIC_ER_VALIDATOR="${NEXT_PUBLIC_ER_VALIDATOR:-MTEWGuqxUpYZGFJQcp8tLN7x5v9BSeoFHYWQQ3n3xzo}"
export NEXT_PUBLIC_USDC_MINT=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
export ADMIN_KEYPAIR PROGRAM_KEYPAIR MAX_LEN

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
ADMIN=$(solana-keygen pubkey "$ADMIN_KEYPAIR")
echo "== PnL Royale mainnet deploy"
echo "   program   $PROGRAM_ID"
echo "   deployer  $ADMIN (becomes upgrade authority + config admin)"
echo "   rpc       $L1_RPC"
echo "   binary    target/deploy/royale.so ($(stat -f%z target/deploy/royale.so 2>/dev/null || stat -c%s target/deploy/royale.so) bytes), max-len $MAX_LEN"

echo "== Preflight"
npx tsx scripts/preflight.ts < /dev/null

if solana program show "$PROGRAM_ID" -u "$L1_RPC" -k "$ADMIN_KEYPAIR" >/dev/null 2>&1; then
  echo "== Program already deployed; skipping deploy"
else
  if [ "${CONFIRM:-}" != "deploy" ]; then
    echo "Refusing to spend SOL without CONFIRM=deploy." >&2
    exit 2
  fi
  [ -f "$BUFFER_KEYPAIR" ] || solana-keygen new --no-bip39-passphrase --silent -o "$BUFFER_KEYPAIR" >/dev/null
  chmod 600 "$BUFFER_KEYPAIR"
  echo "== Deploying (buffer $(solana-keygen pubkey "$BUFFER_KEYPAIR"); re-run this script to resume if writes are rate-limited)"
  solana program deploy target/deploy/royale.so \
    --program-id "$PROGRAM_KEYPAIR" \
    --buffer "$BUFFER_KEYPAIR" \
    --max-len "$MAX_LEN" \
    --with-compute-unit-price "$PRIORITY" \
    --use-rpc --max-sign-attempts 50 \
    -u "$L1_RPC" -k "$ADMIN_KEYPAIR"
fi
solana program show "$PROGRAM_ID" -u "$L1_RPC" -k "$ADMIN_KEYPAIR"

echo "== init_config (fee vault owner: ${FEE_VAULT_OWNER:-$ADMIN})"
npx tsx scripts/init-config.ts < /dev/null

echo "== Done. Optional hardening, run yourself when ready:"
echo "   solana program set-upgrade-authority $PROGRAM_ID --new-upgrade-authority <hardware wallet> -u $L1_RPC -k $ADMIN_KEYPAIR"
echo "   (keep the admin key until config is initialized; set_upgrade_authority is irreversible to a key you don't hold)"
