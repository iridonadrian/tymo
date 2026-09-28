import { describe, expect, it } from "vitest";
import { classify } from "./linkcheck";

const URL = "https://example.com/post";

describe("link check classification", () => {
  it("marks 404/410 broken immediately and other failures only on the second strike", () => {
    expect(classify(undefined, { code: 404 }, URL, 1)).toMatchObject({
      status: "broken",
      failures: 1,
    });
    const first = classify(undefined, { code: null, error: "ENOTFOUND" }, URL, 1);
    expect(first).toMatchObject({ status: "error", failures: 1 });
    expect(classify(first, { code: 503 }, URL, 2)).toMatchObject({ status: "broken", failures: 2 });
  });

  it("recovers, detects moves, and ignores bot walls", () => {
    const broken = classify(undefined, { code: 410 }, URL, 1);
    expect(classify(broken, { code: 200, finalUrl: URL }, URL, 2)).toMatchObject({
      status: "ok",
      failures: 0,
    });
    expect(
      classify(undefined, { code: 200, finalUrl: "https://example.com/new" }, URL, 1),
    ).toMatchObject({
      status: "moved",
      finalUrl: "https://example.com/new",
    });
    // Tracking params / trailing slashes don't count as a move.
    expect(classify(undefined, { code: 200, finalUrl: URL + "?utm_source=x" }, URL, 1).status).toBe(
      "ok",
    );
    expect(classify(undefined, { code: 403 }, URL, 1).status).toBe("ok");
    expect(classify(broken, { code: 429 }, URL, 2).status).toBe("broken");
  });
});
