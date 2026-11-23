"use client";
import { ShieldAlert, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { IS_TEE } from "@/lib/royale/constants";
import type { ErLink } from "@/lib/royale/er";
import { Pill } from "./ui";

export function TeeBadge({ er, error }: { er: ErLink | null; error: string | null }) {
  if (!IS_TEE) return <Pill tone="warn">Public rollup</Pill>;
  if (error)
    return (
      <Pill tone="down">
        <ShieldAlert size={13} /> TEE unreachable
      </Pill>
    );
  if (!er)
    return (
      <Pill>
        <ShieldEllipsis size={13} /> Connecting to TEE
      </Pill>
    );
  return (
    <span title="The MagicBlock TEE's remote attestation was verified in your browser. Reads use a token bound to your session key.">
      <Pill tone="up">
        <ShieldCheck size={13} /> TEE {er.attested ? "attested" : "connected"}
      </Pill>
    </span>
  );
}
