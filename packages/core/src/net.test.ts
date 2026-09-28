import { describe, expect, it } from "vitest";
import { checkFetchUrl, isPublicAddress } from "./net";

describe("isPublicAddress", () => {
  it.each([
    "127.0.0.1",
    "127.1.2.3",
    "10.0.0.1",
    "172.16.5.4",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "0.0.0.0",
    "100.64.0.1",
    "100.127.255.255",
    "224.0.0.1",
    "255.255.255.255",
    "198.18.0.1",
    "192.0.2.1",
    "192.0.0.8",
    "240.0.0.1",
    "::1",
    "::",
    "fe80::1",
    "fc00::1",
    "fd12:3456::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "2002:7f00:1::",
    "2001:db8::1",
    "not-an-ip",
  ])("blocks %s", (ip) => expect(isPublicAddress(ip)).toBe(false));

  it.each([
    "1.1.1.1",
    "8.8.8.8",
    "140.82.112.3",
    "2606:4700:4700::1111",
    "2a00:1450:4001:80b::200e",
    "::ffff:8.8.8.8",
  ])("allows %s", (ip) => expect(isPublicAddress(ip)).toBe(true));
});

describe("checkFetchUrl", () => {
  it.each([
    "file:///etc/passwd",
    "ftp://example.com",
    "gopher://example.com",
    "javascript:alert(1)",
    "http://localhost/",
    "http://LOCALHOST./",
    "http://foo.localhost/",
    "http://printer.local/",
    "http://metadata.google.internal/computeMetadata/v1/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://2130706433/",
    "http://0x7f.1/",
    "http://017700000001/",
    "http://169.254.169.254/latest/meta-data",
    "http://user:pass@example.com/",
    "http://example.com:22/",
    "http://example.com:6379/",
    "http://intranet/",
    "http://[::ffff:7f00:1]/",
  ])("rejects %s", (url) => expect(checkFetchUrl(url).ok).toBe(false));

  it.each([
    "https://example.com/",
    "http://example.com:8080/x",
    "https://github.com/a/b?x=1",
    "https://1.1.1.1/",
  ])("accepts %s", (url) => expect(checkFetchUrl(url).ok).toBe(true));
});
