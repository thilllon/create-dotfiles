import { createCipheriv, createHmac, pbkdf2Sync, timingSafeEqual } from "node:crypto";
import { inflateRawSync } from "node:zlib";

export interface AesZipEntry {
  name: string;
  data: Buffer;
  /** 1 = AE-1 (real CRC stored), 2 = AE-2 (CRC stored as 0). */
  vendorVersion: number;
  /** 1 = AES-128, 2 = AES-192, 3 = AES-256. */
  strength: number;
  /** The CRC-32 field in the central directory. */
  crc32: number;
  /** The CRC-32 field in the local header. */
  localCrc32: number;
  /** The CRC-32 in the data descriptor, when the entry has one (general purpose bit 3). */
  descriptorCrc32: number | undefined;
  /** The entry's salt, hex; WinZip requires a fresh one per entry. */
  salt: string;
  /** Unix mode from the external attributes (0 when the zip was not made on a Unix host). */
  mode: number;
}

const SALT_LENGTH: Readonly<Record<number, number>> = { 1: 8, 2: 12, 3: 16 };

/**
 * Keystream for WinZip's AES-CTR: AES-encrypted 128-bit little-endian counters starting at 1.
 * Node's aes-*-ctr counts big-endian, so the counter blocks are encrypted one by one with ECB.
 */
function ctrXor(key: Buffer, data: Buffer): Buffer {
  const ecb = createCipheriv(`aes-${key.length * 8}-ecb`, key, null);
  ecb.setAutoPadding(false);
  const out = Buffer.alloc(data.length);
  const counter = Buffer.alloc(16);
  for (let offset = 0, block = 1n; offset < data.length; offset += 16, block += 1n) {
    counter.fill(0);
    counter.writeBigUInt64LE(block);
    const keystream = ecb.update(counter);
    for (let i = 0; i < 16 && offset + i < data.length; i++) {
      out[offset + i] = data[offset + i] ^ keystream[i];
    }
  }
  return out;
}

function extraField(extra: Buffer, id: number): Buffer | undefined {
  for (let p = 0; p + 4 <= extra.length; ) {
    const size = extra.readUInt16LE(p + 2);
    if (extra.readUInt16LE(p) === id) return extra.subarray(p + 4, p + 4 + size);
    p += 4 + size;
  }
  return undefined;
}

/**
 * Decrypts a WinZip AES zip with nothing but node:crypto and node:zlib, written from the
 * WinZip AE-x specification, so the tests never trust zip.js to check its own output. Every
 * entry must be AES-encrypted. A wrong password throws, as does a failed authentication code.
 * No ZIP64: test archives are small.
 */
export function readAesZip(zip: Buffer, password: string): AesZipEntry[] {
  const eocd = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error("not a zip: no end of central directory record");

  const entries: AesZipEntry[] = [];
  let p = zip.readUInt32LE(eocd + 16);
  for (let remaining = zip.readUInt16LE(eocd + 10); remaining > 0; remaining--) {
    const flags = zip.readUInt16LE(p + 8);
    const method = zip.readUInt16LE(p + 10);
    const crc32 = zip.readUInt32LE(p + 16);
    const compressedSize = zip.readUInt32LE(p + 20);
    const nameLength = zip.readUInt16LE(p + 28);
    const extraLength = zip.readUInt16LE(p + 30);
    const commentLength = zip.readUInt16LE(p + 32);
    const externalAttributes = zip.readUInt32LE(p + 38);
    const localOffset = zip.readUInt32LE(p + 42);
    const name = zip.toString("utf8", p + 46, p + 46 + nameLength);
    const aes = extraField(
      zip.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength),
      0x9901
    );
    p += 46 + nameLength + extraLength + commentLength;

    if (
      (flags & 1) === 0 ||
      method !== 99 ||
      aes === undefined ||
      aes.toString("latin1", 2, 4) !== "AE"
    ) {
      throw new Error(`${name} is not WinZip AES encrypted`);
    }
    const vendorVersion = aes.readUInt16LE(0);
    const strength = aes[4];
    const actualMethod = aes.readUInt16LE(5);
    const saltLength = SALT_LENGTH[strength];
    const keyLength = saltLength * 2;

    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const salt = zip.subarray(dataStart, dataStart + saltLength);
    const verifier = zip.subarray(dataStart + saltLength, dataStart + saltLength + 2);
    const encrypted = zip.subarray(dataStart + saltLength + 2, dataStart + compressedSize - 10);
    const mac = zip.subarray(dataStart + compressedSize - 10, dataStart + compressedSize);

    let descriptorCrc32: number | undefined;
    if ((flags & 8) !== 0) {
      const at = dataStart + compressedSize;
      const signed = zip.readUInt32LE(at) === 0x08074b50;
      descriptorCrc32 = zip.readUInt32LE(signed ? at + 4 : at);
    }

    const derived = pbkdf2Sync(password, salt, 1000, keyLength * 2 + 2, "sha1");
    if (!derived.subarray(keyLength * 2).equals(verifier)) {
      throw new Error(`wrong password for ${name}`);
    }
    const expectedMac = createHmac("sha1", derived.subarray(keyLength, keyLength * 2))
      .update(encrypted)
      .digest()
      .subarray(0, 10);
    if (!timingSafeEqual(expectedMac, mac)) throw new Error(`authentication failed for ${name}`);

    const compressed = ctrXor(derived.subarray(0, keyLength), encrypted);
    const data = actualMethod === 8 ? inflateRawSync(compressed) : compressed;
    entries.push({
      name,
      data,
      vendorVersion,
      strength,
      crc32,
      localCrc32: zip.readUInt32LE(localOffset + 14),
      descriptorCrc32,
      salt: salt.toString("hex"),
      mode: externalAttributes >>> 16,
    });
  }
  return entries;
}
