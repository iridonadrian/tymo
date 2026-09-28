import { headers } from "next/headers";
import { connection } from "next/server";
import { OAuthError, checkAuthorizeRequest, publicOrigin, SCOPE_WRITE } from "@/server/oauth";
import { Logo } from "@/components/logo";
import { ConsentForm } from "./consent-form";

export const metadata = { title: "Connect an app" };

/**
 * OAuth consent screen. Behind the password gate (the proxy sends you to /login first), so
 * only the owner can approve. Invalid requests are explained here, never redirected.
 */
export default async function AuthorizePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await connection();
  const raw = Object.fromEntries(
    Object.entries(await searchParams).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    ),
  );
  const origin = publicOrigin(await headers());
  let content: React.ReactNode;
  try {
    const req = await checkAuthorizeRequest(raw, origin);
    content = (
      <ConsentForm
        params={raw}
        appName={req.client.name}
        redirectHost={req.redirectHost}
        wantsWrite={req.scopes.includes(SCOPE_WRITE)}
      />
    );
  } catch (err) {
    const msg = err instanceof OAuthError ? err.message : "Something went wrong.";
    content = (
      <div role="alert" className="space-y-2">
        <h1 className="text-base font-semibold">Can’t connect this app</h1>
        <p className="text-sm text-fg-2">{msg}</p>
        <p className="text-xs text-muted">Start the connection again from the app.</p>
      </div>
    );
  }
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6">
        <div className="mb-5 flex items-center gap-2.5">
          <Logo size={26} />
          <div>
            <p className="font-semibold">Tymo</p>
            <p className="eyebrow">Connect an app</p>
          </div>
        </div>
        {content}
      </div>
    </main>
  );
}
