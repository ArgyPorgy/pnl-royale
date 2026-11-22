"use client";
import { IS_TEE } from "@/lib/royale/constants";
import type { ErLink } from "@/lib/royale/er";

export function TeeBadge({ er, error }: { er: ErLink | null; error: string | null }) {
  if (!IS_TEE) return <span className="chip text-gold">public ER (fallback)</span>;
  if (error) return <span className="chip text-short" title={error}>TEE unreachable</span>;
  if (!er) return <span className="chip text-dim">connecting to TEE…</span>;
  return (
    <span className="chip text-tee" title="Remote attestation of the MagicBlock TEE RPC verified in your browser; reads use a token bound to your session key">
      🔒 TEE {er.attested ? "attested" : "connected"}
    </span>
  );
}
