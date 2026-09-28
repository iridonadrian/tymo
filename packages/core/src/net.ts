/**
 * Network safety policy for server-side fetches (SSRF defence).
 * Pure functions: the server's fetcher calls these from its DNS lookup hook.
 */
import ipaddr from "ipaddr.js";

export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

const BLOCKED_HOST_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".intranet",
  ".lan",
  ".home.arpa",
  ".corp",
];
const BLOCKED_HOSTS = new Set([
  "localhost",
  "metadata",
  "metadata.google.internal",
  "instance-data",
]);

export type UrlCheck = { ok: true; url: URL } | { ok: false; reason: string };

/** Static checks that don't need DNS. */
export function checkFetchUrl(raw: string): UrlCheck {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "Invalid URL" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, reason: "Only http and https URLs can be fetched" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "URLs with credentials are not fetched" };
  }
  if (!ALLOWED_PORTS.has(url.port)) {
    return { ok: false, reason: `Port ${url.port} is not allowed` };
  }
  // URL() lowercases and punycodes hostnames; IPv6 literals keep their brackets.
  const host = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (!host) return { ok: false, reason: "Missing host" };
  if (BLOCKED_HOSTS.has(host) || BLOCKED_HOST_SUFFIXES.some((s) => host.endsWith(s))) {
    return { ok: false, reason: "Local hostnames are not fetched" };
  }
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    return { ok: false, reason: "Private or reserved addresses are not fetched" };
  }
  // Single-label hosts ("intranet", "router") resolve via search domains → internal.
  if (!host.includes(".") && !ipaddr.isValid(host)) {
    return { ok: false, reason: "Single-label hostnames are not fetched" };
  }
  return { ok: true, url };
}

/**
 * True only for globally routable unicast addresses.
 * Everything special — loopback, private, link-local (incl. cloud metadata 169.254.169.254),
 * CGNAT, multicast, reserved, documentation, benchmarking, ULA, IPv4-mapped/embedding IPv6 — is false.
 */
export function isPublicAddress(address: string): boolean {
  let parsed: ipaddr.IPv4 | ipaddr.IPv6;
  try {
    parsed = ipaddr.parse(address);
  } catch {
    return false;
  }
  if (parsed.kind() === "ipv6") {
    const v6 = parsed as ipaddr.IPv6;
    if (v6.isIPv4MappedAddress()) return isPublicAddress(v6.toIPv4Address().toString());
    // Any IPv6 range that tunnels/embeds IPv4 or is otherwise special is refused outright.
    if (v6.range() !== "unicast") return false;
    // Only 2000::/3 is allocated global unicast.
    return (v6.parts[0]! & 0xe000) === 0x2000;
  }
  const v4 = parsed as ipaddr.IPv4;
  if (v4.range() !== "unicast") return false;
  // Belt and braces for ranges some ipaddr.js versions classify as unicast.
  const [a, b] = v4.octets as [number, number, number, number];
  if (a === 0 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return false; // benchmarking
  if (a === 192 && b === 0) return false; // 192.0.0.0/24, 192.0.2.0/24
  return true;
}
