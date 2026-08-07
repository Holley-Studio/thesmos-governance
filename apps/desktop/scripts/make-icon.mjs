// Copyright (c) 2024–2026 Holley Studio LLC. All rights reserved.
/**
 * Generate the Thesmos app mark as a PNG, for `tauri icon` to derive every
 * platform size from.
 *
 * The mark is a geometric theta — Θ, for θεσμός — drawn as a ring crossed by a
 * bar. Classical in derivation, not a clip-art glyph: it is constructed from
 * proportion (ring at 0.34 of the canvas, bar at 0.46 width) rather than set in
 * a "Greek" typeface.
 *
 * Written with a hand-rolled PNG encoder over `node:zlib` so icon generation
 * needs no image dependency. The format is small enough — signature, IHDR,
 * IDAT, IEND — that a library would be more supply chain than it saves.
 */

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SIZE = 1024;
const GROUND = [14, 15, 17]; // obsidian
const MARK = [176, 138, 84]; // bronze

/** CRC-32, as PNG chunks require. */
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (const byte of buf) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// ── Draw ─────────────────────────────────────────────────────────────────────
const cx = SIZE / 2;
const cy = SIZE / 2;
const ringOuter = SIZE * 0.34;
const ringInner = SIZE * 0.265;
const barHalfWidth = SIZE * 0.23;
const barHalfHeight = SIZE * 0.038;

/** Coverage 0..1 with a soft edge, so the mark is antialiased rather than jagged. */
function ringCoverage(x, y) {
  const d = Math.hypot(x - cx, y - cy);
  const edge = 1.5;
  const outer = Math.min(1, Math.max(0, (ringOuter - d) / edge + 0.5));
  const inner = Math.min(1, Math.max(0, (d - ringInner) / edge + 0.5));
  return Math.min(outer, inner);
}

function barCoverage(x, y) {
  const edge = 1.5;
  const inX = Math.min(1, Math.max(0, (barHalfWidth - Math.abs(x - cx)) / edge + 0.5));
  const inY = Math.min(1, Math.max(0, (barHalfHeight - Math.abs(y - cy)) / edge + 0.5));
  return Math.min(inX, inY);
}

// Raw scanlines: one filter byte (0 = None) then RGB triples.
const raw = Buffer.alloc(SIZE * (1 + SIZE * 3));
let p = 0;
for (let y = 0; y < SIZE; y++) {
  raw[p++] = 0;
  for (let x = 0; x < SIZE; x++) {
    const a = Math.max(ringCoverage(x + 0.5, y + 0.5), barCoverage(x + 0.5, y + 0.5));
    for (let c = 0; c < 3; c++) {
      raw[p++] = Math.round(GROUND[c] * (1 - a) + MARK[c] * a);
    }
  }
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);
ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; // bit depth
ihdr[9] = 2; // truecolour
// bytes 10-12: deflate, adaptive filtering, no interlace — all zero.

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, '..', 'assets');
mkdirSync(out, { recursive: true });
const file = join(out, 'app-icon.png');
writeFileSync(file, png);
console.log(`[icon] wrote ${file} (${SIZE}×${SIZE}, ${(png.length / 1024).toFixed(1)}kB)`);
