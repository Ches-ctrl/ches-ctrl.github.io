'use strict';
/**
 * Exercises the pure codec functions inside static/voice.js: downsample, pcm16,
 * b64 and unb64. Everything else in that file needs a microphone and an
 * AudioContext, neither of which exists here - these four functions are the
 * whole reason `window.__ask.__codec` exists.
 *
 * static/voice.js is loaded with node:vm rather than require()d, because it is a
 * browser IIFE that assigns to `window`, not a CommonJS module. The context below
 * is deliberately minimal: at load time the file only reads `window.__askConfig`
 * and assigns `window.__ask`, so that plus btoa/atob is everything it touches
 * before start() is ever called.
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadVoice() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'static', 'voice.js'), 'utf8');
  const window = { __askConfig: {} };
  const context = { window: window, console: console, btoa: btoa, atob: atob };
  vm.createContext(context);
  vm.runInContext(src, context, { filename: 'static/voice.js' });
  return window.__ask.__codec;
}

const { downsample, pcm16, b64, unb64 } = loadVoice();

// ---------------------------------------------------------------- downsample

test('downsample at 3:1 box-averages rather than dropping samples', () => {
  // A ramp 0..8999, at 3:1 each output sample is the mean of 3 consecutive inputs.
  const f32 = new Float32Array(9000);
  for (let i = 0; i < f32.length; i++) f32[i] = i;
  const out = downsample(f32, 48000, 16000);
  assert.equal(out.length, 3000);
  assert.equal(out[0], 1); // mean(0, 1, 2)
  assert.equal(out[1], 4); // mean(3, 4, 5)
  assert.equal(out[999], 2998); // mean(2997, 2998, 2999)
});

test('downsample is the identity when rates match, not a rounded copy', () => {
  const f32 = new Float32Array([0.1, -0.2, 0.30000001, -1, 1]);
  const out = downsample(f32, 16000, 16000);
  assert.strictEqual(out, f32); // same object, not a recomputed one
});

test('downsample at a non-integer ratio produces a sane length with no NaN', () => {
  const inRate = 44100, outRate = 16000, secs = 1;
  const f32 = new Float32Array(inRate * secs);
  for (let i = 0; i < f32.length; i++) f32[i] = Math.sin(i);
  const out = downsample(f32, inRate, outRate);
  const expected = Math.floor(f32.length / (inRate / outRate));
  assert.equal(out.length, expected);
  assert.equal(out.some((v) => Number.isNaN(v)), false);
  assert.ok(Math.abs(out.length - outRate) < outRate * 0.05, 'length should be close to ' + outRate);
});

// ---------------------------------------------------------------- pcm16

test('pcm16 writes little-endian, not the platform-default or big-endian order', () => {
  // 0.5 * 0x7fff = 16383.5, truncated by setInt16 to 16383 = 0x3FFF.
  const buf = pcm16(new Float32Array([0.5]));
  const view = new DataView(buf);
  assert.equal(view.getInt16(0, true), 16383); // read as little-endian: correct
  assert.notEqual(view.getInt16(0, false), 16383); // read as big-endian: must disagree

  // And check the raw bytes directly, not just a DataView reading it back -
  // this is what actually catches an endianness slip in the write itself.
  const bytes = new Uint8Array(buf);
  assert.equal(bytes[0], 0xff); // low byte first (0x3FFF & 0xFF)
  assert.equal(bytes[1], 0x3f); // high byte second (0x3FFF >> 8)
});

test('pcm16 clamps out-of-range floats instead of wrapping', () => {
  const buf = pcm16(new Float32Array([2, -2]));
  const view = new DataView(buf);
  assert.equal(view.getInt16(0, true), 0x7fff); // clamped to +max, not wrapped to near-zero
  assert.equal(view.getInt16(2, true), -0x8000); // clamped to -max
});

test('pcm16 scales +1.0 and -1.0 asymmetrically, matching signed 16-bit range', () => {
  const buf = pcm16(new Float32Array([1, -1]));
  const view = new DataView(buf);
  assert.equal(view.getInt16(0, true), 0x7fff); // +1 -> 32767
  assert.equal(view.getInt16(2, true), -0x8000); // -1 -> -32768
});

// ---------------------------------------------------------------- b64 / unb64

test('b64 -> unb64 round-trips within two quantisation steps', () => {
  const f32 = new Float32Array(1000);
  for (let i = 0; i < f32.length; i++) f32[i] = Math.sin(i / 10) * 0.9;
  const round = unb64(b64(pcm16(f32)));
  // setInt16 truncates the fractional code towards zero rather than rounding it,
  // so the worst case is bounded by two quantisation steps, not one - a value near
  // +/-1 can lose almost a full step to truncation on top of the step itself.
  const step = 2 / 32768;
  for (let i = 0; i < f32.length; i++) {
    assert.ok(Math.abs(round[i] - f32[i]) <= step, 'sample ' + i + ' drifted more than two quantisation steps');
  }
});

test('b64 handles a buffer past the real String.fromCharCode.apply argument limit', () => {
  // Measured directly on this Node/V8: apply() on a byte array of 65538 or 100000
  // still works; it throws RangeError at 131072. 0x8000 (the chunk size in the
  // source) is nowhere near that ceiling on its own - the previous version of this
  // test used a 0x8000+1-byte buffer, which the un-chunked, single-call
  // `String.fromCharCode.apply(null, bytes)` also passes, so deleting the chunking
  // loop entirely still left it green. 131072 Int16 samples = 262144 bytes clears
  // the measured 131072-byte throw point with a 2x margin for engine variation.
  const n = 131072;
  const f32 = new Float32Array(n);
  for (let i = 0; i < n; i++) f32[i] = ((i % 2000) / 1000) - 1; // sawtooth, exercises varied byte values
  const buf = pcm16(f32);
  const encoded = b64(buf);

  // Compare against Buffer's own base64 encoder - an independent implementation,
  // not a re-derivation of b64's own chunking logic - so a wrong chunk boundary
  // (off-by-one, dropped tail, doubled overlap) shows up as a string mismatch
  // instead of merely "did not throw".
  const expected = Buffer.from(new Uint8Array(buf)).toString('base64');
  assert.equal(encoded, expected);

  const round = unb64(encoded);
  assert.equal(round.length, n); // not truncated at the chunk boundary
  const step = 2 / 32768;
  assert.ok(Math.abs(round[0] - f32[0]) <= step);
  assert.ok(Math.abs(round[n - 1] - f32[n - 1]) <= step);
});
