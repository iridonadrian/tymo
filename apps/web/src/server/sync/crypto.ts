/**
 * Encryption for everything Tymo writes to a sync folder. The folder lives in someone
 * else's cloud (iCloud Drive, Google Drive…), so it only ever holds ciphertext:
 * AES-256-GCM with a key derived from the user's passphrase (scrypt, per-library salt).
 *
 * File layout: "TYMOSYN1" | iv (12) | tag (16) | ciphertext of gzip(payload).
 * The purpose ("log", "blob", "check") is bound as additional data, so a file can't be
 * passed off as another kind.
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scrypt } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const MAGIC = Buffer.from("TYMOSYN1");
const KDF = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const CHECK_TEXT = "tymo-sync-v1";

export type Purpose = "log" | "blob" | "check";

export function newSalt(): Buffer {
  return randomBytes(16);
}

export function deriveKey(passphrase: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(passphrase.normalize("NFKC"), salt, 32, KDF, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export function seal(data: Buffer, key: Buffer, purpose: Purpose): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(gzipSync(data)), cipher.final()]);
  return Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]);
}

/** Throws when the file is damaged, incomplete, of another purpose or from another key. */
export function open(file: Buffer, key: Buffer, purpose: Purpose): Buffer {
  if (file.length < MAGIC.length + 28 || !file.subarray(0, MAGIC.length).equals(MAGIC))
    throw new Error("Not a Tymo sync file");
  const iv = file.subarray(8, 20);
  const tag = file.subarray(20, 36);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(purpose));
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(file.subarray(36)), decipher.final()]);
  return gunzipSync(plain, { maxOutputLength: 512 * 1024 * 1024 });
}

/** A value stored next to the salt that proves a passphrase is the right one. */
export function makeCheck(key: Buffer): string {
  return seal(Buffer.from(CHECK_TEXT), key, "check").toString("base64");
}

export function verifyCheck(check: string, key: Buffer): boolean {
  try {
    return open(Buffer.from(check, "base64"), key, "check").toString() === CHECK_TEXT;
  } catch {
    return false;
  }
}

/** Blob file names don't reveal the file's own hash (which could confirm a known file). */
export function blobName(sha256: string, key: Buffer): string {
  return createHmac("sha256", key).update(`blob:${sha256}`).digest("hex");
}
