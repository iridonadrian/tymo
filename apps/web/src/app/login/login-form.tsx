"use client";

import { useActionState } from "react";
import { loginAction } from "@/server/actions";
import { Logo } from "@/components/logo";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(loginAction, {});
  return (
    <form
      action={action}
      className="relative w-full max-w-sm rounded-xl border border-border bg-surface p-6"
    >
      <div className="mb-5 flex items-center gap-2.5">
        <Logo size={26} />
        <div>
          <h1 className="font-semibold">Tymo</h1>
          <p className="eyebrow">Private library</p>
        </div>
      </div>
      <input type="hidden" name="next" value={next} />
      <label className="eyebrow mb-1 block" htmlFor="password">
        Password
      </label>
      <input
        id="password"
        name="password"
        type="password"
        autoFocus
        required
        autoComplete="current-password"
        className="input"
      />
      {state?.error && (
        <p role="alert" className="mt-2 text-sm text-danger">
          {state.error}
        </p>
      )}
      <button
        type="submit"
        disabled={pending}
        className="mt-4 h-9 w-full rounded-lg bg-accent text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-60"
      >
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
