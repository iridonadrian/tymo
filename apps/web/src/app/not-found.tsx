import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="eyebrow">404</p>
      <h1 className="text-lg font-semibold">Not in your memory</h1>
      <Link href="/" className="text-sm text-accent-ink hover:underline">
        Back home
      </Link>
    </main>
  );
}
