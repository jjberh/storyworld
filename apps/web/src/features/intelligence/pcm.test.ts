import { describe, expect, it } from "vitest";
import { floatToPcm16, pcm16ToBase64 } from "./pcm";

describe("floatToPcm16", () => {
  it("scales samples to 16-bit and clamps overshoot", () => {
    const pcm = floatToPcm16(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2]));
    expect([...pcm]).toEqual([0, 32767, -32768, 16383, -16384, 32767, -32768]);
  });

  it("keeps the length and handles empty input", () => {
    expect(floatToPcm16(new Float32Array(300)).length).toBe(300);
    expect(floatToPcm16(new Float32Array(0)).length).toBe(0);
  });
});

describe("pcm16ToBase64", () => {
  it("encodes little-endian 16-bit samples", () => {
    const samples = new Int16Array([1, -2, 32767, -32768]);
    const bytes = Buffer.from(pcm16ToBase64(samples), "base64");
    expect(bytes.length).toBe(8);
    expect([0, 2, 4, 6].map((i) => bytes.readInt16LE(i))).toEqual([
      1, -2, 32767, -32768,
    ]);
  });

  it("encodes a sub-view without including the rest of the buffer", () => {
    const backing = new Int16Array([9, 9, 5, 6, 9]);
    const view = backing.subarray(2, 4);
    const bytes = Buffer.from(pcm16ToBase64(view), "base64");
    expect([bytes.readInt16LE(0), bytes.readInt16LE(2)]).toEqual([5, 6]);
    expect(bytes.length).toBe(4);
  });

  it("handles buffers larger than one chunk", () => {
    const samples = new Int16Array(50_000).map((_, i) => (i % 2000) - 1000);
    const bytes = Buffer.from(pcm16ToBase64(samples), "base64");
    expect(bytes.length).toBe(100_000);
    expect(bytes.readInt16LE(99_998)).toBe(samples[49_999]);
  });
});
