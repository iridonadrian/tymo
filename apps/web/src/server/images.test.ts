import { describe, expect, it } from "vitest";
import { getProxiedImage, sniffImage } from "./images";

const enc = (s: string) => new TextEncoder().encode(s);

describe("image proxy", () => {
  it("sniffs images by their bytes", () => {
    expect(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffImage(enc("GIF89a"))).toBe("image/gif");
    expect(sniffImage(enc("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(enc("\0\0\0\x1cftypavif"))).toBe("image/avif");
    expect(sniffImage(Uint8Array.from([0, 0, 1, 0, 1, 0]))).toBe("image/x-icon");
    expect(sniffImage(enc('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">'))).toBe(
      "image/svg+xml",
    );
    expect(sniffImage(enc("<html><svg></svg></html>"))).toBeNull();
    expect(sniffImage(enc("<script>alert(1)</script>"))).toBeNull();
    expect(sniffImage(enc("%PDF-1.7"))).toBeNull();
  });

  it("refuses private addresses and caches the failure", async () => {
    expect(await getProxiedImage("http://127.0.0.1/favicon.ico")).toBeNull();
    expect(await getProxiedImage("http://169.254.169.254/latest/meta-data/")).toBeNull();
    expect(await getProxiedImage("http://localhost/x.png")).toBeNull();
  });
});
