/**
 * XHS (Xiaohongshu / RedNote) API signing algorithm.
 *
 * Pure TypeScript implementation translated from the xhshow Python library.
 * Original: https://github.com/xhshow/xhshow (MIT License)
 *
 * MIT License
 * Copyright (c) xhshow contributors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * Self-contained — only depends on Node.js built-in `crypto` module.
 */

import { createHash, randomBytes } from 'node:crypto';

// ─── Constants ───────────────────────────────────────────────────────────────

const STANDARD_BASE64 =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const CUSTOM_BASE64 =
  'ZmserbBoHQtNP+wOcza/LpngG8yJq42KWYj0DSfdikx3VT16IlUAFM97hECvuRX5';
const X3_BASE64 =
  'MfgqrsbcyzPQRStuvC7mn501HIJBo2DEFTKdeNOwxWXYZap89+/A4UVLhijkl63G';

const HEX_KEY =
  '71a302257793271ddd273bcee3e4b98d9d7935e1da33f5765e2ea8afb6dc77a51a499d23' +
  'b67c20660025860cbf13d4540d92497f58686c574e508f46e1956344f39139bf4faf22a3' +
  'eef120b79258145b2feb5193b6478669961298e79bedca646e1a693a926154a5a7a1bd1c' +
  'f0dedb742f917a747a1e388b234f2277516db7116035439730fa61e9822a0eca7bff72d8';

const VERSION_BYTES = [121, 104, 96, 41];
const A3_PREFIX = [2, 97, 51, 16];
const PAYLOAD_LENGTH = 144;
const A1_LENGTH = 52;
const APP_ID_LENGTH = 10;
const MD5_XOR_LENGTH = 8;
const HASH_IV: [number, number, number, number] = [
  1831565813, 461845907, 2246822507, 3266489909,
];
const ENV_TABLE = [115, 248, 83, 102, 103, 201, 181, 131, 99, 94, 4, 68, 250, 132, 21];
const ENV_CHECKS_DEFAULT = [0, 1, 18, 1, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0];
const X3_PREFIX = 'mns0301_';
const XYS_PREFIX = 'XYS_';
const B1_SECRET_KEY = 'xhswebmplfbt';

const SIGNATURE_DATA_TEMPLATE = {
  x0: '4.2.6',
  x1: 'xhs-pc-web',
  x2: 'Windows',
  x3: '',
  x4: '',
};

const SIGNATURE_XSCOMMON_TEMPLATE = {
  s0: 5,
  s1: '',
  x0: '1',
  x1: '4.2.6',
  x2: 'Windows',
  x3: 'xhs-pc-web',
  x4: '4.86.0',
  x5: '',
  x6: '',
  x7: '',
  x8: '',
  x9: -596800761,
  x10: 0,
  x11: 'normal',
};

// ─── Fingerprint data (representative subset) ───────────────────────────────

const GPU_VENDORS = [
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) HD Graphics 400 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1060 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 2060 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 580 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (AMD)|ANGLE (AMD, AMD Radeon RX 5700 XT Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (Intel)|ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce GTX 1650 Direct3D11 vs_5_0 ps_5_0)',
  'Google Inc. (NVIDIA)|ANGLE (NVIDIA, NVIDIA GeForce RTX 4060 Direct3D11 vs_5_0 ps_5_0)',
];

const SCREEN_RESOLUTIONS = ['1366;768', '1600;900', '1920;1080', '2560;1440', '3840;2160', '7680;4320'];
const SCREEN_WEIGHTS = [0.25, 0.15, 0.35, 0.15, 0.08, 0.02];

const COLOR_DEPTH_VALUES = [16, 24, 30, 32];
const COLOR_DEPTH_WEIGHTS = [0.05, 0.6, 0.05, 0.3];

const DEVICE_MEMORY_VALUES = [1, 2, 4, 8, 12, 16];
const DEVICE_MEMORY_WEIGHTS = [0.10, 0.25, 0.4, 0.2, 0.03, 0.01];

const CORE_VALUES = [2, 4, 6, 8, 12, 16, 24, 32];
const CORE_WEIGHTS = [0.1, 0.4, 0.2, 0.15, 0.08, 0.04, 0.02, 0.01];

const BROWSER_PLUGINS =
  'PDF Viewer,Chrome PDF Viewer,Chromium PDF Viewer,Microsoft Edge PDF Viewer,WebKit built-in PDF';
const CANVAS_HASH = '742cc32c';
const VOICE_HASH = '10311144241322244122';
const FONTS =
  'system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Segoe UI Symbol", "Noto Color Emoji"';

// ─── Utility helpers ─────────────────────────────────────────────────────────

/** Pick a random item from `values` according to weighted distribution. */
function weightedChoice<T>(values: T[], weights: number[]): T {
  const r = Math.random();
  let cum = 0;
  for (let i = 0; i < values.length; i++) {
    cum += weights[i];
    if (r < cum) return values[i];
  }
  return values[values.length - 1];
}

/** Convert HEX_KEY string to byte array (each pair of hex chars → byte). */
function hexKeyToBytes(): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < HEX_KEY.length; i += 2) {
    bytes.push(parseInt(HEX_KEY.substring(i, i + 2), 16));
  }
  return bytes;
}

/** Write a 32-bit unsigned integer in little-endian into `arr` at `offset`. */
function writeU32LE(arr: number[], offset: number, value: number): void {
  const v = value >>> 0;
  arr[offset] = v & 0xff;
  arr[offset + 1] = (v >>> 8) & 0xff;
  arr[offset + 2] = (v >>> 16) & 0xff;
  arr[offset + 3] = (v >>> 24) & 0xff;
}

/** Write a 64-bit value in little-endian (as two 32-bit halves) into `arr`. */
function writeU64LE(arr: number[], offset: number, value: number): void {
  // JS number is 64-bit float, safe up to 2^53 — fine for ms timestamps
  const lo = value & 0xffffffff;
  const hi = Math.floor(value / 0x100000000) & 0xffffffff;
  writeU32LE(arr, offset, lo);
  writeU32LE(arr, offset + 4, hi);
}

/** Rotate left for 32-bit unsigned integer. */
function rotl32(x: number, r: number): number {
  return (((x << r) | (x >>> (32 - r))) >>> 0);
}

/** MD5 hex digest of a UTF-8 string. */
function md5hex(input: string): string {
  return createHash('md5').update(Buffer.from(input, 'utf-8')).digest('hex');
}

/** Base64 encode with standard alphabet, then substitute characters. */
function customBase64Encode(input: string, table: string): string {
  const b64 = Buffer.from(input, 'utf-8').toString('base64');
  let result = '';
  for (const ch of b64) {
    const idx = STANDARD_BASE64.indexOf(ch);
    result += idx >= 0 ? table[idx] : ch; // '=' and padding pass through
  }
  return result;
}

/** Base64 encode raw bytes with character substitution. */
function customBase64EncodeBytes(input: number[], table: string): string {
  const b64 = Buffer.from(input).toString('base64');
  let result = '';
  for (const ch of b64) {
    const idx = STANDARD_BASE64.indexOf(ch);
    result += idx >= 0 ? table[idx] : ch;
  }
  return result;
}

// ─── Core algorithm ──────────────────────────────────────────────────────────

/** Step 1: Extract the pure API path (strip query string and JSON body marker). */
function extractApiPath(contentString: string): string {
  let path = contentString;
  const braceIdx = path.indexOf('{');
  if (braceIdx >= 0) path = path.substring(0, braceIdx);
  const qIdx = path.indexOf('?');
  if (qIdx >= 0) path = path.substring(0, qIdx);
  return path;
}

/** Step 2: Build the content string from method, URI, and optional payload. */
function buildContentString(
  method: string,
  uri: string,
  payload?: Record<string, unknown>,
): string {
  if (method.toUpperCase() === 'POST' && payload) {
    return uri + JSON.stringify(payload);
  }
  return uri;
}

/**
 * Step 5: Custom hash v2 — processes input in 8-byte blocks.
 * Returns 16 bytes (4 × 32-bit state words).
 */
function customHashV2(input: number[]): number[] {
  let [h0, h1, h2, h3] = HASH_IV;

  // Process 8 bytes at a time
  const blockCount = Math.floor(input.length / 8);
  for (let i = 0; i < blockCount; i++) {
    const off = i * 8;
    // Read two 32-bit LE words
    let k1 =
      (input[off] | (input[off + 1] << 8) | (input[off + 2] << 16) | (input[off + 3] << 24)) >>> 0;
    let k2 =
      (input[off + 4] | (input[off + 5] << 8) | (input[off + 6] << 16) | (input[off + 7] << 24)) >>> 0;

    // Mix k1 into h0
    k1 = Math.imul(k1, h1) >>> 0;
    k1 = rotl32(k1, 7);
    k1 = Math.imul(k1, h2) >>> 0;
    h0 = (h0 ^ k1) >>> 0;
    h0 = rotl32(h0, 11);
    h0 = ((Math.imul(h0, 5) >>> 0) + 0x561fed8b) >>> 0;

    // Mix k2 into h1
    k2 = Math.imul(k2, h2) >>> 0;
    k2 = rotl32(k2, 13);
    k2 = Math.imul(k2, h1) >>> 0;
    h1 = (h1 ^ k2) >>> 0;
    h1 = rotl32(h1, 17);
    h1 = ((Math.imul(h1, 5) >>> 0) + 0x0bcaa747) >>> 0;
  }

  // Handle remaining bytes (tail)
  const tail = input.length % 8;
  if (tail > 0) {
    const off = blockCount * 8;
    let tk1 = 0;
    let tk2 = 0;

    if (tail >= 5) {
      for (let j = Math.min(tail, 8) - 1; j >= 4; j--) {
        tk2 = ((tk2 << 8) | input[off + j]) >>> 0;
      }
      tk2 = Math.imul(tk2, h2) >>> 0;
      tk2 = rotl32(tk2, 13);
      tk2 = Math.imul(tk2, h1) >>> 0;
      h1 = (h1 ^ tk2) >>> 0;
    }

    for (let j = Math.min(tail, 4) - 1; j >= 0; j--) {
      tk1 = ((tk1 << 8) | input[off + j]) >>> 0;
    }
    tk1 = Math.imul(tk1, h1) >>> 0;
    tk1 = rotl32(tk1, 7);
    tk1 = Math.imul(tk1, h2) >>> 0;
    h0 = (h0 ^ tk1) >>> 0;
  }

  // Finalization: XOR length into both halves, then fmix
  const len = input.length >>> 0;
  h0 = (h0 ^ len) >>> 0;
  h1 = (h1 ^ len) >>> 0;
  h0 = (h0 + h1) >>> 0;
  h1 = (h1 + h0) >>> 0;

  // fmix h0
  h0 = (h0 ^ (h0 >>> 9)) >>> 0;
  h0 = Math.imul(h0, 0x3c4e9a21) >>> 0;
  h0 = (h0 ^ (h0 >>> 13)) >>> 0;
  h0 = Math.imul(h0, 0x6c49a7b1) >>> 0;
  h0 = (h0 ^ (h0 >>> 17)) >>> 0;

  // fmix h1
  h1 = (h1 ^ (h1 >>> 9)) >>> 0;
  h1 = Math.imul(h1, 0x3c4e9a21) >>> 0;
  h1 = (h1 ^ (h1 >>> 13)) >>> 0;
  h1 = Math.imul(h1, 0x6c49a7b1) >>> 0;
  h1 = (h1 ^ (h1 >>> 17)) >>> 0;

  // fmix h2
  h2 = (h2 ^ (h2 >>> 9)) >>> 0;
  h2 = Math.imul(h2, 0x3c4e9a21) >>> 0;
  h2 = (h2 ^ (h2 >>> 13)) >>> 0;
  h2 = Math.imul(h2, 0x6c49a7b1) >>> 0;
  h2 = (h2 ^ (h2 >>> 19)) >>> 0;

  // fmix h3
  h3 = (h3 ^ (h3 >>> 9)) >>> 0;
  h3 = Math.imul(h3, 0x3c4e9a21) >>> 0;
  h3 = (h3 ^ (h3 >>> 13)) >>> 0;
  h3 = Math.imul(h3, 0x6c49a7b1) >>> 0;
  h3 = (h3 ^ (h3 >>> 19)) >>> 0;

  h0 = (h0 + h1) >>> 0;
  h1 = (h1 + h0) >>> 0;
  h2 = (h2 + h3) >>> 0;
  h3 = (h3 + h2) >>> 0;

  // Output 16 bytes (4 × u32 LE)
  const out: number[] = new Array(16);
  writeU32LE(out, 0, h0);
  writeU32LE(out, 4, h1);
  writeU32LE(out, 8, h2);
  writeU32LE(out, 12, h3);
  return out;
}

/**
 * Step 4: Build the 144-byte payload array.
 */
function buildPayloadArray(
  md5Hex: string,
  a1: string,
  appId: string,
  contentString: string,
  timestampMs: number,
): number[] {
  const payload = new Array<number>(PAYLOAD_LENGTH).fill(0);

  // [0-3] Version bytes
  for (let i = 0; i < 4; i++) payload[i] = VERSION_BYTES[i];

  // [4-7] Random seed (4 bytes)
  const seedBuf = randomBytes(4);
  for (let i = 0; i < 4; i++) payload[4 + i] = seedBuf[i];
  const seedByte = seedBuf[0]; // seed & 0xFF

  // [8-15] Current timestamp in ms (8 LE bytes)
  writeU64LE(payload, 8, timestampMs);

  // [16-23] Page load timestamp = (timestamp - randomOffset(3..30s)) * 1000
  const offsetSec = 3 + Math.floor(Math.random() * 28); // 3..30
  const pageLoadTs = timestampMs - offsetSec * 1000;
  writeU64LE(payload, 16, pageLoadTs);

  // [24-27] Sequence value: random 15..50
  const seqVal = 15 + Math.floor(Math.random() * 36);
  writeU32LE(payload, 24, seqVal);

  // [28-31] Window props length: random 1000..2000
  const winProps = 1000 + Math.floor(Math.random() * 1001);
  writeU32LE(payload, 28, winProps);

  // [32-35] Content string UTF-8 byte length
  const contentBytes = Buffer.from(contentString, 'utf-8');
  writeU32LE(payload, 32, contentBytes.length);

  // [36-43] First 8 bytes of MD5 hex XORed with seedByte
  for (let i = 0; i < MD5_XOR_LENGTH; i++) {
    payload[36 + i] = md5Hex.charCodeAt(i) ^ seedByte;
  }

  // [44] a1 UTF-8 byte length (capped at A1_LENGTH)
  const a1Bytes = Buffer.from(a1, 'utf-8');
  const a1Len = Math.min(a1Bytes.length, A1_LENGTH);
  payload[44] = a1Len;

  // [45-96] a1 padded to 52 bytes
  for (let i = 0; i < a1Len; i++) payload[45 + i] = a1Bytes[i];

  // [97] appId UTF-8 byte length (capped at APP_ID_LENGTH)
  const appIdBytes = Buffer.from(appId, 'utf-8');
  const appIdLen = Math.min(appIdBytes.length, APP_ID_LENGTH);
  payload[97] = appIdLen;

  // [98-107] appId padded to 10 bytes
  for (let i = 0; i < appIdLen; i++) payload[98 + i] = appIdBytes[i];

  // [108-123] Environment detection bytes
  payload[108] = 1;
  payload[109] = seedByte ^ ENV_TABLE[0];
  for (let i = 1; i < 15; i++) {
    payload[108 + 1 + i] = ENV_TABLE[i] ^ ENV_CHECKS_DEFAULT[i];
  }

  // [124-143] A3_PREFIX (4 bytes) + customHashV2(...) XORed with seedByte (16 bytes)
  for (let i = 0; i < 4; i++) payload[124 + i] = A3_PREFIX[i];

  // Build hash input: timestamp bytes + MD5(apiPath) bytes
  const apiPath = extractApiPath(contentString);
  const apiPathMd5 = md5hex(apiPath);

  // timestamp as 8 LE bytes
  const tsBytes: number[] = new Array(8);
  writeU64LE(tsBytes, 0, timestampMs);

  // MD5 hex → raw bytes (16 bytes)
  const md5Bytes: number[] = [];
  for (let i = 0; i < 32; i += 2) {
    md5Bytes.push(parseInt(apiPathMd5.substring(i, i + 2), 16));
  }

  // Concatenate for hash input
  const hashInput = [...tsBytes, ...md5Bytes];
  const hashResult = customHashV2(hashInput);

  // XOR hash result with seedByte and write to payload
  for (let i = 0; i < 16; i++) {
    payload[128 + i] = hashResult[i] ^ seedByte;
  }

  return payload;
}

/** Step 6: XOR-transform the payload array with HEX_KEY bytes. */
function xorTransformArray(payload: number[]): number[] {
  const keyBytes = hexKeyToBytes();
  const result = new Array<number>(payload.length);
  for (let i = 0; i < payload.length; i++) {
    result[i] = (payload[i] ^ keyBytes[i % keyBytes.length]) & 0xff;
  }
  return result;
}

// ─── RC4 cipher ──────────────────────────────────────────────────────────────

function rc4(key: string, data: string): number[] {
  const keyBytes = Buffer.from(key, 'utf-8');
  const dataBytes = Buffer.from(data, 'utf-8');

  // KSA
  const S = new Array<number>(256);
  for (let i = 0; i < 256; i++) S[i] = i;
  let j = 0;
  for (let i = 0; i < 256; i++) {
    j = (j + S[i] + keyBytes[i % keyBytes.length]) & 0xff;
    [S[i], S[j]] = [S[j], S[i]];
  }

  // PRGA
  const output = new Array<number>(dataBytes.length);
  let x = 0;
  let y = 0;
  for (let k = 0; k < dataBytes.length; k++) {
    x = (x + 1) & 0xff;
    y = (y + S[x]) & 0xff;
    [S[x], S[y]] = [S[y], S[x]];
    output[k] = dataBytes[k] ^ S[(S[x] + S[y]) & 0xff];
  }
  return output;
}

// ─── CRC32 JS variant ───────────────────────────────────────────────────────

/** CRC32 table (polynomial 0xEDB88320). */
const CRC32_TABLE: number[] = (() => {
  const table = new Array<number>(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
      c = c >>> 0;
    }
    table[n] = c;
  }
  return table;
})();

/**
 * CRC32 JS variant: standard CRC32, but finalized with extra XOR against
 * the polynomial, then converted to signed 32-bit.
 */
function crc32js(input: string): number {
  let c = 0xffffffff;
  for (let i = 0; i < input.length; i++) {
    c = (CRC32_TABLE[(c ^ input.charCodeAt(i)) & 0xff] ^ (c >>> 8)) >>> 0;
  }
  // XHS variant: extra XOR with polynomial
  const unsigned = (0xffffffff ^ c ^ 0xedb88320) >>> 0;
  // Convert to signed 32-bit integer
  return unsigned | 0;
}

// ─── Fingerprint generation ─────────────────────────────────────────────────

/** Generate a random fingerprint object for x-s-common b1 field. */
function generateFingerprint(a1: string, timestampMs: number): Record<string, unknown> {
  const screen = weightedChoice(SCREEN_RESOLUTIONS, SCREEN_WEIGHTS);
  const [width, height] = screen.split(';').map(Number);
  const colorDepth = weightedChoice(COLOR_DEPTH_VALUES, COLOR_DEPTH_WEIGHTS);
  const deviceMemory = weightedChoice(DEVICE_MEMORY_VALUES, DEVICE_MEMORY_WEIGHTS);
  const cores = weightedChoice(CORE_VALUES, CORE_WEIGHTS);
  const gpu = GPU_VENDORS[Math.floor(Math.random() * GPU_VENDORS.length)];
  const [gpuVendor, gpuRenderer] = gpu.split('|');

  // Generate random webId-like string
  const webId = randomBytes(16).toString('hex');

  // Random timezone offset (common values: -480 to +540)
  const tzOffset = -480;

  return {
    x33: gpuVendor,
    x34: gpuRenderer,
    x35: `${width}x${height}`,
    x36: `${width}x${height}`,
    x37: colorDepth,
    x38: cores,
    x39: deviceMemory,
    x40: BROWSER_PLUGINS,
    x41: CANVAS_HASH,
    x42: VOICE_HASH,
    x43: FONTS,
    x44: 0,          // webdriver
    x45: 0,          // languages
    x46: 'en-US',
    x47: tzOffset,
    x48: `${tzOffset}`,
    x49: webId,
    x50: a1,
    x51: timestampMs,
    x52: '',
    x82: '',
  };
}

/** Build the b1 field: RC4-encrypt fingerprint JSON, then URL-encode, then custom base64. */
function buildB1(a1: string, timestampMs: number): string {
  const fp = generateFingerprint(a1, timestampMs);

  // Extract 18 fields for b1
  const b1Data: Record<string, unknown> = {};
  const b1Keys = [
    'x33', 'x34', 'x35', 'x36', 'x37', 'x38', 'x39', 'x40',
    'x41', 'x42', 'x43', 'x44', 'x45', 'x46', 'x47', 'x48',
    'x49', 'x50', 'x51', 'x52', 'x82',
  ];
  for (const k of b1Keys) {
    if (k in fp) b1Data[k] = fp[k];
  }

  const b1Json = JSON.stringify(b1Data);

  // RC4 encrypt with B1_SECRET_KEY
  const encrypted = rc4(B1_SECRET_KEY, b1Json);

  // URL-encode as latin1: each byte → %XX
  let urlEncoded = '';
  for (const byte of encrypted) {
    urlEncoded += '%' + byte.toString(16).padStart(2, '0');
  }

  // Parse %XX tokens to bytes, then custom base64 encode
  const encBytes: number[] = [];
  for (let i = 0; i < urlEncoded.length; ) {
    if (urlEncoded[i] === '%' && i + 2 < urlEncoded.length) {
      encBytes.push(parseInt(urlEncoded.substring(i + 1, i + 3), 16));
      i += 3;
    } else {
      encBytes.push(urlEncoded.charCodeAt(i));
      i++;
    }
  }

  return customBase64EncodeBytes(encBytes, CUSTOM_BASE64);
}

// ─── x-s generation ─────────────────────────────────────────────────────────

/**
 * Generate the x-s header value.
 *
 * Steps:
 * 1. Build content string from method/uri/payload
 * 2. MD5 the content string
 * 3. Build 144-byte payload array
 * 4. XOR-transform with HEX_KEY
 * 5. Encode with X3 base64
 * 6. Wrap in XYS_ + custom base64 JSON envelope
 */
function generateXS(
  method: string,
  uri: string,
  cookies: Record<string, string>,
  payload?: Record<string, unknown>,
  timestampMs?: number,
): string {
  const ts = timestampMs ?? Date.now();
  const a1 = cookies.a1 ?? '';
  const appId = '';

  // Step 2: Build content string and hash it
  const contentString = buildContentString(method, uri, payload);
  const md5Hex = md5hex(contentString);

  // Step 3-4: Build payload → XOR transform
  const payloadArr = buildPayloadArray(md5Hex, a1, appId, contentString, ts);
  const xorResult = xorTransformArray(payloadArr);

  // Step 5: Encode with X3 base64 alphabet
  const x3Encoded = customBase64EncodeBytes(xorResult, X3_BASE64);

  // Step 6: Wrap in XYS_ envelope
  const sigData = {
    ...SIGNATURE_DATA_TEMPLATE,
    x3: X3_PREFIX + x3Encoded,
    x4: String(ts),
  };
  return XYS_PREFIX + customBase64Encode(JSON.stringify(sigData), CUSTOM_BASE64);
}

// ─── x-s-common generation ──────────────────────────────────────────────────

/**
 * Generate the x-s-common header value.
 *
 * Steps:
 * 1. Generate fingerprint and build b1 from it
 * 2. CRC32-js of b1 string → x9
 * 3. Fill template with a1, b1, x9
 * 4. JSON → custom base64
 */
function generateXSCommon(
  a1: string,
  timestampMs: number,
): string {
  const b1 = buildB1(a1, timestampMs);
  const x9 = crc32js(b1);

  const data = {
    ...SIGNATURE_XSCOMMON_TEMPLATE,
    s1: '',
    x5: a1,
    x6: '',
    x7: '',
    x8: b1,
    x9,
    x10: 0,
  };

  return customBase64Encode(JSON.stringify(data), CUSTOM_BASE64);
}

// ─── Trace ID generation ─────────────────────────────────────────────────────

/** Generate x-b3-traceid: 16 random hex characters. */
function generateB3TraceId(): string {
  return randomBytes(8).toString('hex');
}

/** Generate x-xray-traceid: 32 hex chars. First 16 from timestamp, last 16 random. */
function generateXrayTraceId(timestampMs: number): string {
  // First 16 hex chars: (timestamp_ms << 23) | random_seq → but we need 64-bit math
  // Use BigInt for the shift operation
  const tsBig = BigInt(timestampMs);
  const shifted = tsBig << 23n;
  const seq = BigInt(Math.floor(Math.random() * 0x7fffff));
  const combined = shifted | seq;
  const first16 = (combined & 0xffffffffffffffffn).toString(16).padStart(16, '0').slice(-16);

  // Last 16 hex chars: random
  const last16 = randomBytes(8).toString('hex');

  return first16 + last16;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Generate XHS API signing headers.
 *
 * @param method  HTTP method ('POST' or 'GET')
 * @param uri     API path (e.g. '/api/sns/web/v1/search/notes')
 * @param cookies Cookie dict — must include 'a1'
 * @param payload POST body object (optional for GET)
 * @returns Headers: x-s, x-s-common, x-t, x-b3-traceid, x-xray-traceid
 */
export function signHeaders(
  method: string,
  uri: string,
  cookies: Record<string, string>,
  payload?: Record<string, unknown>,
): Record<string, string> {
  const timestampMs = Date.now();
  const a1 = cookies.a1 ?? '';

  const xs = generateXS(method, uri, cookies, payload, timestampMs);
  const xsCommon = generateXSCommon(a1, timestampMs);
  const xt = String(timestampMs);
  const b3TraceId = generateB3TraceId();
  const xrayTraceId = generateXrayTraceId(timestampMs);

  return {
    'x-s': xs,
    'x-s-common': xsCommon,
    'x-t': xt,
    'x-b3-traceid': b3TraceId,
    'x-xray-traceid': xrayTraceId,
  };
}
