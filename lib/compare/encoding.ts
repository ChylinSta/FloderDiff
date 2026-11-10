import type { TextEncoding } from "./types";

export type SampleEncoding = TextEncoding | "binary";

export function sniffEncoding(sample: Buffer): SampleEncoding {
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  if (sample.includes(0)) return "binary";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "utf-8";
  } catch {
    return "binary";
  }
}

export function decodeSample(sample: Buffer, encoding: TextEncoding): string {
  const decoded =
    encoding === "utf-8"
      ? new TextDecoder("utf-8", { fatal: true }).decode(hasUtf8Bom(sample) ? sample.subarray(3) : sample)
      : new TextDecoder(encoding, { fatal: false }).decode(sample);
  return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
}

export function encodingLabel(encoding: TextEncoding): string {
  if (encoding === "utf-16le") return "UTF-16 LE";
  if (encoding === "utf-16be") return "UTF-16 BE";
  return "UTF-8";
}

function hasUtf8Bom(sample: Buffer): boolean {
  return sample.length >= 3 && sample[0] === 0xef && sample[1] === 0xbb && sample[2] === 0xbf;
}
