/**
 * Hybrid logical clock: versions that sort like wall-clock time but never go backwards on a
 * device and always move past versions seen from other devices, so "newest edit wins" works
 * even when computer clocks disagree a little. Format: 13-digit ms, 5-digit counter, device.
 * Plain string comparison orders them.
 */
export class Hlc {
  private ms = 0;
  private counter = 0;

  constructor(
    private readonly device: string,
    private readonly clock: () => number = Date.now,
  ) {}

  now(): string {
    const wall = this.clock();
    if (wall > this.ms) {
      this.ms = wall;
      this.counter = 0;
    } else {
      this.counter++;
    }
    return format(this.ms, this.counter, this.device);
  }

  /** Moves this clock past a version seen from another device. */
  observe(version: string) {
    const parsed = parse(version);
    if (!parsed) return;
    if (parsed.ms > this.ms || (parsed.ms === this.ms && parsed.counter > this.counter)) {
      this.ms = parsed.ms;
      this.counter = parsed.counter;
    }
  }
}

/** A version for a past moment (a row's last edit), below anything the clock issues later. */
export function atTime(ms: number, device: string): string {
  return format(ms, 0, device);
}

function format(ms: number, counter: number, device: string) {
  return `${String(ms).padStart(13, "0")}-${String(counter).padStart(5, "0")}-${device}`;
}

export function parse(version: string): { ms: number; counter: number } | null {
  const m = /^(\d{13})-(\d{5})-[\w-]+$/.exec(version);
  return m ? { ms: Number(m[1]), counter: Number(m[2]) } : null;
}
