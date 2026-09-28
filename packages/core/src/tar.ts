/**
 * Minimal ustar (POSIX tar) header encoding/decoding for Tymo backups.
 * Only regular files with short, validated names are supported — enough for
 * `tymo.db` + `files/<id>`, and strict enough that a hostile archive can't escape.
 */

export const TAR_BLOCK = 512;

const enc = new TextEncoder();
const dec = new TextDecoder();

function writeString(buf: Uint8Array, offset: number, len: number, value: string) {
  const bytes = enc.encode(value);
  buf.set(bytes.subarray(0, len), offset);
}

function writeOctal(buf: Uint8Array, offset: number, len: number, value: number) {
  // len-1 octal digits, then NUL.
  writeString(buf, offset, len - 1, value.toString(8).padStart(len - 1, "0"));
}

/** Names allowed in a backup: letters, digits, dot, dash, underscore, one level of folder. */
export function isSafeTarName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length < 100 &&
    /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)?$/.test(name) &&
    !name.split("/").some((p) => p === "." || p === "..")
  );
}

export function tarHeader(name: string, size: number, mtimeMs = Date.now()): Uint8Array {
  if (!isSafeTarName(name)) throw new Error(`Unsafe tar entry name: ${name}`);
  if (!Number.isSafeInteger(size) || size < 0 || size > 0o77777777777)
    throw new Error("Entry too large");
  const h = new Uint8Array(TAR_BLOCK);
  writeString(h, 0, 100, name);
  writeOctal(h, 100, 8, 0o600);
  writeOctal(h, 108, 8, 0);
  writeOctal(h, 116, 8, 0);
  writeOctal(h, 124, 12, size);
  writeOctal(h, 136, 12, Math.floor(mtimeMs / 1000));
  h.fill(0x20, 148, 156); // checksum field counts as spaces
  h[156] = 0x30; // '0' regular file
  writeString(h, 257, 6, "ustar");
  writeString(h, 263, 2, "00");
  let sum = 0;
  for (const b of h) sum += b;
  writeString(h, 148, 7, sum.toString(8).padStart(6, "0") + "\0");
  return h;
}

/** Zero padding needed after `size` bytes of content. */
export function tarPadding(size: number): number {
  return (TAR_BLOCK - (size % TAR_BLOCK)) % TAR_BLOCK;
}

/** Two zero blocks mark the end of the archive. */
export const TAR_END = new Uint8Array(TAR_BLOCK * 2);

export type TarHeader = { name: string; size: number; type: string } | "end";

/** Parses one 512-byte header block; throws on anything malformed. */
export function parseTarHeader(h: Uint8Array): TarHeader {
  if (h.length !== TAR_BLOCK) throw new Error("Truncated tar header");
  if (h.every((b) => b === 0)) return "end";
  const str = (o: number, l: number) => dec.decode(h.subarray(o, o + l)).replace(/\0.*$/s, "");
  const oct = (o: number, l: number) => {
    const v = str(o, l).trim();
    if (!/^[0-7]+$/.test(v)) throw new Error("Malformed tar header");
    return parseInt(v, 8);
  };
  const expected = oct(148, 8);
  let sum = 0;
  for (let i = 0; i < TAR_BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i]!;
  if (sum !== expected) throw new Error("Tar checksum mismatch");
  const prefix = str(345, 155);
  const name = (prefix ? prefix + "/" : "") + str(0, 100);
  const type = String.fromCharCode(h[156] || 0x30);
  return { name, size: oct(124, 12), type };
}
