/** WAV encoding and decoding: 16-bit PCM stereo, and reading back for tests. */

export function encodeWav(left, right, sampleRate, bits = 16) {
  const channels = right ? 2 : 1;
  const frames = left.length;
  const bytesPer = bits / 8;
  const dataBytes = frames * channels * bytesPer;
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * channels * bytesPer, 28); buf.writeUInt16LE(channels * bytesPer, 32);
  buf.writeUInt16LE(bits, 34); buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40);
  let o = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const v = Math.max(-1, Math.min(1, c === 0 ? left[i] : right[i]));
      if (bits === 16) { buf.writeInt16LE(Math.round(v * 32767), o); o += 2; }
      else { const s = Math.round(v * 8388607); buf.writeUInt8(s & 0xff, o); buf.writeUInt8((s >> 8) & 0xff, o + 1); buf.writeUInt8((s >> 16) & 0xff, o + 2); o += 3; }
    }
  }
  return buf;
}

export function decodeWav(buf) {
  const channels = buf.readUInt16LE(22);
  const sampleRate = buf.readUInt32LE(24);
  const bits = buf.readUInt16LE(34);
  let pos = 12;
  while (buf.toString('ascii', pos, pos + 4) !== 'data') pos += 8 + buf.readUInt32LE(pos + 4);
  const dataBytes = buf.readUInt32LE(pos + 4);
  const frames = dataBytes / channels / (bits / 8);
  const out = Array.from({ length: channels }, () => new Float32Array(frames));
  let o = pos + 8;
  for (let i = 0; i < frames; i++) for (let c = 0; c < channels; c++) { out[c][i] = buf.readInt16LE(o) / 32768; o += 2; }
  return { sampleRate, channels: out };
}
