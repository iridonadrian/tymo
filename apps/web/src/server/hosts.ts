/**
 * DNS-rebinding guard. Without a password, Tymo trusts anyone who can reach it — normally only
 * this machine. A malicious site can point its own domain at 127.0.0.1 and then talk to Tymo
 * "same-origin" (read /export, call Server Actions). Such requests carry the attacker's
 * hostname in the Host header, so in no-password mode only local names, IP literals and
 * explicitly allowed hosts (TYMO_ALLOWED_HOSTS=tymo.lan,nas.home) are accepted.
 */
const LOCAL_NAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

function hostname(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1); // [::1]:3210
  return h.replace(/:\d+$/, "");
}

const isIpLiteral = (h: string) => /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || /^\[[0-9a-f:.]+\]$/.test(h);

export function hostAllowed(
  hostHeader: string | null,
  allowedEnv = process.env.TYMO_ALLOWED_HOSTS,
) {
  if (!hostHeader) return false;
  const h = hostname(hostHeader);
  if (LOCAL_NAMES.has(h) || isIpLiteral(h)) return true;
  const extra = (allowedEnv ?? "")
    .split(",")
    .map((s) => hostname(s))
    .filter(Boolean);
  return extra.includes(h);
}
