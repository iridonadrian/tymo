import { notFound } from "next/navigation";
import { getSession } from "@/server/sessions";
import { SessionView } from "@/components/session-view";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const s = await getSession((await params).id);
  return { title: s?.name ?? "Session" };
}

export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await getSession((await params).id);
  if (!session) notFound();
  return <SessionView session={session} />;
}
