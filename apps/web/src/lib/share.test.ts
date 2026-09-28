import { describe, expect, it } from "vitest";
import { sharePrefill } from "./share";

describe("sharePrefill", () => {
  it("prefers the url, then a link inside text, then the text itself", () => {
    expect(sharePrefill({ url: "https://a.dev/x", text: "hi" })).toBe("https://a.dev/x");
    expect(sharePrefill({ title: "Cool", text: "Look at this https://b.dev/y?z=1 wow" })).toBe(
      "https://b.dev/y?z=1",
    );
    expect(sharePrefill({ title: "Idea", text: "remember milk" })).toBe("Idea\nremember milk");
    expect(sharePrefill({})).toBe("");
  });
});
