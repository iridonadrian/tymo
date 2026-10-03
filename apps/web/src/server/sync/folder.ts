/**
 * The sync folder (e.g. iCloud Drive/Tymo Sync), shared by all devices of one library:
 *
 *   tymo-sync.json                 salt + passphrase check (no secrets)
 *   devices/<device>/<seq>.tsc     each device's change log; only that device writes here
 *   blobs/<hmac>.tsb               file contents (images, PDFs, archived pages)
 *
 * Every device writes only its own files, and never rewrites one, so cloud drives never
 * see two devices edit the same file. Everything except the config is encrypted.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";

export interface FolderConfig {
  app: "tymo";
  format: 1;
  salt: string;
  check: string;
  createdAt: number;
}

const DEVICE_RE = /^[a-f0-9]{16}$/;
const LOG_RE = /^(\d{12})\.tsc$/;

export class SyncFolder {
  constructor(readonly root: string) {}

  private configPath() {
    return path.join(this.root, "tymo-sync.json");
  }

  async readConfig(): Promise<FolderConfig | null> {
    try {
      const c = JSON.parse(await fs.readFile(this.configPath(), "utf8")) as FolderConfig;
      return c?.app === "tymo" && c.format === 1 && c.salt && c.check ? c : null;
    } catch {
      return null;
    }
  }

  async writeConfig(config: FolderConfig) {
    await fs.mkdir(this.root, { recursive: true });
    await writeAtomic(this.configPath(), Buffer.from(JSON.stringify(config, null, 2)));
  }

  async devices(): Promise<string[]> {
    try {
      const names = await fs.readdir(path.join(this.root, "devices"));
      return names.filter((n) => DEVICE_RE.test(n));
    } catch {
      return [];
    }
  }

  /** Sequence numbers of a device's log files, ascending. */
  async logs(device: string): Promise<number[]> {
    try {
      const dir = path.join(this.root, "devices", device);
      const names = await fs.readdir(dir);
      requestDownloads(dir, names);
      return names
        .map((n) => LOG_RE.exec(n)?.[1])
        .filter((n): n is string => !!n)
        .map(Number)
        .sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  private logPath(device: string, seq: number) {
    if (!DEVICE_RE.test(device) || !Number.isSafeInteger(seq) || seq < 1)
      throw new Error("Invalid log name");
    return path.join(this.root, "devices", device, `${String(seq).padStart(12, "0")}.tsc`);
  }

  readLog(device: string, seq: number): Promise<Buffer> {
    return fs.readFile(this.logPath(device, seq));
  }

  async writeLog(device: string, seq: number, data: Buffer) {
    const file = this.logPath(device, seq);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, data);
  }

  /** When a device last wrote a change (its newest log file), or null if never. */
  async lastChange(device: string): Promise<number | null> {
    const seqs = await this.logs(device);
    const last = seqs.at(-1);
    if (last === undefined) return null;
    try {
      return (await fs.stat(this.logPath(device, last))).mtimeMs;
    } catch {
      return null;
    }
  }

  /** Removes one device's change log (it left the library). */
  async removeDevice(device: string) {
    if (!DEVICE_RE.test(device)) throw new Error("Invalid device");
    await fs.rm(path.join(this.root, "devices", device), { recursive: true, force: true });
  }

  /** Removes every device's log and every file copy, keeping the folder's config. */
  async eraseData() {
    await fs.rm(path.join(this.root, "devices"), { recursive: true, force: true });
    await fs.rm(path.join(this.root, "blobs"), { recursive: true, force: true });
  }

  /** Removes the synced library from the folder. Only Tymo's own files are touched. */
  async eraseAll() {
    await this.eraseData();
    await fs.rm(this.configPath(), { force: true });
    await fs.rmdir(this.root).catch(() => {}); // only if nothing else is in it
  }

  private blobPath(name: string) {
    if (!/^[a-f0-9]{64}$/.test(name)) throw new Error("Invalid blob name");
    return path.join(this.root, "blobs", `${name}.tsb`);
  }

  async hasBlob(name: string): Promise<boolean> {
    try {
      await fs.access(this.blobPath(name));
      return true;
    } catch {
      return false;
    }
  }

  async readBlob(name: string): Promise<Buffer | null> {
    const file = this.blobPath(name);
    try {
      return await fs.readFile(file);
    } catch {
      if (process.platform === "darwin") execFile("brctl", ["download", file], () => {}); // in iCloud but not on this Mac yet
      return null;
    }
  }

  async writeBlob(name: string, data: Buffer) {
    const file = this.blobPath(name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await writeAtomic(file, data);
  }
}

/**
 * Older macOS versions show iCloud files that aren't on this Mac yet as ".<name>.icloud"
 * placeholders; ask iCloud to fetch them so they appear under their real name.
 */
function requestDownloads(dir: string, names: string[]) {
  if (process.platform !== "darwin") return;
  for (const n of names) {
    const m = /^\.(\d{12}\.tsc)\.icloud$/.exec(n);
    if (m) execFile("brctl", ["download", path.join(dir, m[1]!)], () => {});
  }
}

/** Write to a temporary name, then rename, so other devices never see half a file. */
async function writeAtomic(file: string, data: Buffer) {
  const tmp = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${randomBytes(4).toString("hex")}.tmp`,
  );
  await fs.writeFile(tmp, data, { mode: 0o600 });
  await fs.rename(tmp, file);
}
