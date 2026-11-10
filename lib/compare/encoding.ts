import type { TextEncoding } from "./types";

export type SampleEncoding = TextEncoding | "binary";

export function sniffEncoding(sample: Buffer): SampleEncoding {
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  if (sample.includes(0)) {
    const utf16 = sniffUtf16WithoutBom(sample);
    return utf16 ?? "binary";
  }
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "utf-8";
  } catch {
    return "binary";
  }
}

/** ASCII-heavy UTF-16 with no BOM. Short or mixed samples stay binary. */
export function sniffUtf16WithoutBom(sample: Buffer): "utf-16le" | "utf-16be" | null {
  if (sample.length < 8 || sample.length % 2 !== 0) return null;
  const pairs = sample.length / 2;
  let leAscii = 0;
  let beAscii = 0;
  for (let index = 0; index < sample.length; index += 2) {
    const first = sample[index] ?? 0;
    const second = sample[index + 1] ?? 0;
    if (second === 0 && isTextByte(first)) leAscii += 1;
    if (first === 0 && isTextByte(second)) beAscii += 1;
  }
  const leScore = leAscii / pairs;
  const beScore = beAscii / pairs;
  if (leScore >= 0.8 && leAscii >= 4 && leScore >= beScore + 0.2) {
    return decodedTextLooksSafe(sample, "utf-16le") ? "utf-16le" : null;
  }
  if (beScore >= 0.8 && beAscii >= 4 && beScore >= leScore + 0.2) {
    return decodedTextLooksSafe(sample, "utf-16be") ? "utf-16be" : null;
  }
  return null;
}

function isTextByte(value: number): boolean {
  return value === 0x09 || value === 0x0a || value === 0x0d || (value >= 0x20 && value < 0x7f);
}

function decodedTextLooksSafe(sample: Buffer, encoding: "utf-16le" | "utf-16be"): boolean {
  const text = decodeSample(sample, encoding);
  if (text.length < 4 || text.includes("\uFFFD")) return false;
  for (const character of text) {
    const code = character.charCodeAt(0);
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return false;
  }
  return true;
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
