/** WAV encoding and decoding: 16-bit PCM, browser-safe (no Node Buffer). */

/** @returns {Uint8Array} a complete RIFF/WAVE file */
export function encodeWav(left, right, sampleRate, bits = 16) {
  const channels = right ? 2 : 1;
  const frames = left.length;
  const bytesPer = bits / 8;
  const dataBytes = frames * channels * bytesPer;
  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);
  const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); v.setUint32(4, 36 + dataBytes, true); str(8, 'WAVE');
  str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true);
  v.setUint16(22, channels, true); v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * channels * bytesPer, true); v.setUint16(32, channels * bytesPer, true);
  v.setUint16(34, bits, true); str(36, 'data'); v.setUint32(40, dataBytes, true);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const x = Math.max(-1, Math.min(1, c === 0 ? left[i] : right[i]));
      if (bits === 16) { v.setInt16(o, Math.round(x * 32767), true); o += 2; }
      else { const s = Math.round(x * 8388607); v.setUint8(o, s & 0xff); v.setUint8(o + 1, (s >> 8) & 0xff); v.setUint8(o + 2, (s >> 16) & 0xff); o += 3; }
    }
  }
  return new Uint8Array(buf);
}

/** @param {Uint8Array|ArrayBuffer} bytes */
export function decodeWav(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const v = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const tag = (o) => String.fromCharCode(u8[o], u8[o + 1], u8[o + 2], u8[o + 3]);
  const channels = v.getUint16(22, true);
  const sampleRate = v.getUint32(24, true);
  const bits = v.getUint16(34, true);
  let pos = 12;
  while (tag(pos) !== 'data') pos += 8 + v.getUint32(pos + 4, true);
  const dataBytes = v.getUint32(pos + 4, true);
  const frames = Math.floor(dataBytes / channels / (bits / 8));
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let o = pos + 8;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) { out[c][i] = v.getInt16(o, true) / 32768; o += 2; }
  return { sampleRate, channels: out };
}
