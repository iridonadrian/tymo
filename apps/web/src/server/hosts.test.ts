import { describe, expect, it } from "vitest";
import { hostAllowed } from "./hosts";

describe("hostAllowed (DNS rebinding guard)", () => {
  it("accepts local names and IP literals, rejects other hostnames", () => {
    for (const ok of [
      "localhost:3210",
      "127.0.0.1:3210",
      "[::1]:3210",
      "192.168.1.20:3210",
      "LOCALHOST",
    ])
      expect(hostAllowed(ok, "")).toBe(true);
    for (const bad of [
      "evil.example:3210",
      "127.0.0.1.evil.example",
      "localhost.evil.example",
      "",
      null,
    ])
      expect(hostAllowed(bad, "")).toBe(false);
  });
  it("honours TYMO_ALLOWED_HOSTS", () => {
    expect(hostAllowed("tymo.lan:3210", "nas.home, tymo.lan")).toBe(true);
    expect(hostAllowed("other.lan", "nas.home, tymo.lan")).toBe(false);
  });
});
