export default function Loading() {
  return (
    <div className="space-y-4">
      <div className="skeleton h-8 w-48" />
      <div className="skeleton h-40 w-full rounded-[18px]" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="skeleton h-28 rounded-[18px]" />
        <div className="skeleton h-28 rounded-[18px]" />
        <div className="skeleton h-28 rounded-[18px]" />
      </div>
    </div>
  );
}
