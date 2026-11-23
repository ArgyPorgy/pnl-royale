import Link from "next/link";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid place-items-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-20 text-center">
      <LogoMark size={36} />
      <h1 className="display mt-4 text-4xl">This page is off the floor</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">The link doesn&apos;t match a room, a rating, or the lobby.</p>
      <Link href="/" className="mt-5">
        <Button variant="primary">Back to rooms</Button>
      </Link>
    </div>
  );
}
