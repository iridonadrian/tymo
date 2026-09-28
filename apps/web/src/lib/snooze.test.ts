import { describe, expect, it } from "vitest";
import { snoozePresets } from "./snooze";

describe("snoozePresets", () => {
  it("offers sensible local-time presets", () => {
    const wed = new Date(2026, 8, 23, 10, 0); // Wednesday 10:00
    const p = Object.fromEntries(snoozePresets(wed).map((x) => [x.label, new Date(x.until)]));
    expect(p["Later today"]!.getHours()).toBe(13);
    expect(p["Tomorrow"]).toEqual(new Date(2026, 8, 24, 9));
    expect(p["This weekend"]).toEqual(new Date(2026, 8, 26, 9));
    expect(p["Next week"]).toEqual(new Date(2026, 8, 28, 9));
  });

  it("drops presets that make no sense", () => {
    const fridayNight = new Date(2026, 8, 25, 22, 0);
    const labels = snoozePresets(fridayNight).map((x) => x.label);
    expect(labels).not.toContain("Later today");
    expect(labels).not.toContain("This weekend");
    const sunday = snoozePresets(new Date(2026, 8, 27, 10));
    expect(new Date(sunday.find((x) => x.label === "Next week")!.until).getDate()).toBe(28);
  });
});
