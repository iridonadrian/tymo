import { describe, expect, it } from "vitest";
import { domainOf, normalizeUrl, safeHref, stripTracking, titleFromUrl } from "./url";

describe("safeHref", () => {
  it("only allows http(s)", () => {
    expect(safeHref("https://a.com/x")).toBe("https://a.com/x");
    expect(safeHref("javascript:alert(1)")).toBeUndefined();
    expect(safeHref(" JaVaScRiPt:alert(1)")).toBeUndefined();
    expect(safeHref("data:text/html,<script>")).toBeUndefined();
    expect(safeHref("/relative")).toBeUndefined();
    expect(safeHref(null)).toBeUndefined();
  });
});

describe("normalizeUrl", () => {
  it("collapses trivially different URLs", () => {
    const a = normalizeUrl("https://www.Example.com/path/?utm_source=x&b=2&a=1#frag");
    const b = normalizeUrl("http://example.com/path?a=1&b=2");
    expect(a).toBe(b);
    expect(a).toBe("example.com/path?a=1&b=2");
  });
  it("keeps non-default ports and rejects non-http", () => {
    expect(normalizeUrl("https://example.com:8443/")).toBe("example.com:8443");
    expect(normalizeUrl("ftp://example.com")).toBeNull();
  });
});

describe("misc", () => {
  it("domainOf strips www", () => expect(domainOf("https://www.GitHub.com/x")).toBe("github.com"));
  it("stripTracking", () =>
    expect(stripTracking("https://a.com/?utm_medium=x&id=3&fbclid=1")).toBe("https://a.com/?id=3"));
  it("titleFromUrl", () => {
    expect(titleFromUrl("https://example.com/blog/my-great_post.html")).toBe(
      "my great post — example.com",
    );
    expect(titleFromUrl("https://www.example.com/")).toBe("example.com");
  });
});

import { cleanTitle } from "./url";
describe("cleanTitle", () => {
  it("shortens GitHub repo titles", () => {
    expect(
      cleanTitle(
        "GitHub - projectdiscovery/nuclei: Nuclei is fast",
        "https://github.com/projectdiscovery/nuclei",
      ),
    ).toBe("projectdiscovery/nuclei");
    expect(cleanTitle("Some page", "https://example.com")).toBe("Some page");
  });
});
