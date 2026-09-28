import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authEnabled } from "@/server/auth";
import { LoginForm } from "./login-form";
import { CodeField } from "@/components/code-field";

export const metadata = { title: "Sign in" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  await connection(); // auth config is read at runtime, never baked in at build time
  if (!authEnabled()) redirect("/");
  const { next } = await searchParams;
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4">
      <CodeField mask="radial" />
      <LoginForm next={typeof next === "string" ? next : "/"} />
    </main>
  );
}
