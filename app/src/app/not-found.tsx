import Link from "next/link";
import { LogoMark } from "@/components/brand";
import { Button } from "@/components/ui";

export default function NotFound() {
  return (
    <div className="grid place-items-center rounded-[var(--radius-card)] border border-border bg-surface px-6 py-20 text-center">
      <LogoMark size={36} />
      <h1 className="display mt-4 text-5xl text-white">Off the floor.</h1>
      <p className="subhead mt-3 text-2xl text-white">That link doesn&apos;t match.</p>
      <Link href="/" className="mt-5">
        <Button variant="primary">Back to rooms</Button>
      </Link>
    </div>
  );
}
