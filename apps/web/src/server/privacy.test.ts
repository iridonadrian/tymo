import os from "node:os";
import { describe, expect, it } from "vitest";
import { clientIp, displayPath, publicErrorMessage } from "./privacy";

describe("privacy", () => {
  it("never leaks absolute paths or system error details", () => {
    const home = os.homedir();
    expect(publicErrorMessage(new Error(`Cannot open ${home}/secret/tymo.db`))).not.toContain(home);
    expect(publicErrorMessage(new Error("failed at /Users/alice/Documents/x.txt"))).toBe(
      "failed at …",
    );
    expect(publicErrorMessage(new Error("C:\\Users\\bob\\data\\f.db missing"))).toBe("… missing");
    const sys = Object.assign(new Error("ENOENT: no such file, open '/srv/data/x'"), {
      code: "ENOENT",
    });
    expect(publicErrorMessage(sys, "Backup failed")).toBe("Backup failed (ENOENT)");
    expect(publicErrorMessage(new Error("Save not found"))).toBe("Save not found");
    expect(publicErrorMessage("nope")).toBe("Something went wrong");
  });

  it("shortens the home directory and ignores spoofable proxy headers by default", () => {
    expect(displayPath(`${os.homedir()}/tymo/data`)).toBe("~/tymo/data");
    const h = new Headers({ "x-forwarded-for": "1.2.3.4" });
    expect(clientIp(h)).toBe("direct");
    process.env.TYMO_TRUST_PROXY = "1";
    expect(clientIp(h)).toBe("1.2.3.4");
    delete process.env.TYMO_TRUST_PROXY;
  });
});
