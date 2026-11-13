import type { TextEncoding } from "./types";

export type SampleEncoding = TextEncoding | "binary";

export function sniffEncoding(sample: Buffer): SampleEncoding {
  if (sample.length >= 2 && sample[0] === 0xff && sample[1] === 0xfe) return "utf-16le";
  if (sample.length >= 2 && sample[0] === 0xfe && sample[1] === 0xff) return "utf-16be";
  if (!sample.includes(0)) {
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(sample);
      return "utf-8";
    } catch {
      // Fall through. Even-length invalid UTF-8 may be UTF-16 without a BOM.
    }
  }
  const utf16 = sniffUtf16WithoutBom(sample);
  if (utf16) return utf16;
  if (sample.includes(0)) return "binary";
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(sample);
    return "utf-8";
  } catch {
    return "binary";
  }
}

/**
 * UTF-16 LE/BE with no BOM.
 * Accepts ASCII-heavy text (NUL in the other byte) and other letters, including CJK,
 * when one endianness decodes cleanly and the other does not.
 * Four or six bytes are accepted only when every pair is ASCII in exactly one endianness.
 * Two bytes stay undecided: one code unit is too easy to confuse with binary.
 * When both endiannesses look equally like text, this returns null instead of guessing.
 */
export function sniffUtf16WithoutBom(sample: Buffer): "utf-16le" | "utf-16be" | null {
  if (sample.length < 2 || sample.length % 2 !== 0) return null;
  if (sample.length < 8) return sniffShortAsciiUtf16(sample);
  const le = scoreUtf16(sample, "utf-16le");
  const be = scoreUtf16(sample, "utf-16be");
  const leOk = le !== null && le.ratio >= 0.75 && le.good >= 4;
  const beOk = be !== null && be.ratio >= 0.75 && be.good >= 4;
  const nul = nulBias(sample);
  if (leOk && !beOk) return "utf-16le";
  if (beOk && !leOk) return "utf-16be";
  if (leOk && beOk && le && be) {
    if (nul.le >= 0.8 && nul.le > nul.be) return "utf-16le";
    if (nul.be >= 0.8 && nul.be > nul.le) return "utf-16be";
    if (le.ratio >= be.ratio + 0.2) return "utf-16le";
    if (be.ratio >= le.ratio + 0.2) return "utf-16be";
  }
  return null;
}

function sniffShortAsciiUtf16(sample: Buffer): "utf-16le" | "utf-16be" | null {
  if (sample.length < 4) return null;
  const pairs = sample.length / 2;
  const le = countAsciiNulPairs(sample, "utf-16le");
  const be = countAsciiNulPairs(sample, "utf-16be");
  if (le === pairs && be === 0) return "utf-16le";
  if (be === pairs && le === 0) return "utf-16be";
  return null;
}

function countAsciiNulPairs(sample: Buffer, encoding: "utf-16le" | "utf-16be"): number {
  let count = 0;
  for (let index = 0; index < sample.length; index += 2) {
    const first = sample[index] ?? 0;
    const second = sample[index + 1] ?? 0;
    const low = encoding === "utf-16le" ? first : second;
    const high = encoding === "utf-16le" ? second : first;
    if (high === 0 && isAsciiTextByte(low)) count += 1;
  }
  return count;
}

function isAsciiTextByte(value: number): boolean {
  return value === 0x09 || value === 0x0a || value === 0x0d || (value >= 0x20 && value <= 0x7e);
}

function nulBias(sample: Buffer): { le: number; be: number } {
  const pairs = sample.length / 2;
  let le = 0;
  let be = 0;
  for (let index = 0; index < sample.length; index += 2) {
    const first = sample[index] ?? 0;
    const second = sample[index + 1] ?? 0;
    if (second === 0 && first !== 0) le += 1;
    if (first === 0 && second !== 0) be += 1;
  }
  return { le: le / pairs, be: be / pairs };
}

function scoreUtf16(sample: Buffer, encoding: "utf-16le" | "utf-16be"): { good: number; ratio: number } | null {
  const text = decodeUtf16Strict(sample, encoding);
  if (!text) return null;
  const chars = [...text];
  if (chars.length < 4) return null;
  let good = 0;
  for (const character of chars) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0 || code === 0xfffd) return null;
    if (code < 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) return null;
    if (isLikelyText(code)) good += 1;
  }
  return { good, ratio: good / chars.length };
}

function decodeUtf16Strict(sample: Buffer, encoding: "utf-16le" | "utf-16be"): string | null {
  const units: number[] = [];
  for (let index = 0; index < sample.length; index += 2) {
    const first = sample[index] ?? 0;
    const second = sample[index + 1] ?? 0;
    units.push(encoding === "utf-16le" ? first | (second << 8) : (first << 8) | second);
  }
  let text = "";
  for (let index = 0; index < units.length; index += 1) {
    const unit = units[index] ?? 0;
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = units[index + 1];
      if (next === undefined || next < 0xdc00 || next > 0xdfff) return null;
      text += String.fromCodePoint(0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
      index += 1;
      continue;
    }
    if (unit >= 0xdc00 && unit <= 0xdfff) return null;
    text += String.fromCharCode(unit);
  }
  return text;
}

function isLikelyText(code: number): boolean {
  if (code === 0x09 || code === 0x0a || code === 0x0d) return true;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0x00a0 && code <= 0x024f) return true;
  if (code >= 0x0370 && code <= 0x03ff) return true;
  if (code >= 0x0400 && code <= 0x04ff) return true;
  if (code >= 0x3000 && code <= 0x303f) return true;
  if (code >= 0x3040 && code <= 0x30ff) return true;
  if (code >= 0x3400 && code <= 0x9fff) return true;
  if (code >= 0xac00 && code <= 0xd7af) return true;
  if (code >= 0xff00 && code <= 0xffef) return true;
  return false;
}

export function decodeSample(sample: Buffer, encoding: TextEncoding): string {
  if (encoding === "utf-8") {
    const body = hasUtf8Bom(sample) ? sample.subarray(3) : sample;
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(body);
    return decoded.charCodeAt(0) === 0xfeff ? decoded.slice(1) : decoded;
  }
  const strict = decodeUtf16Strict(sample, encoding);
  if (strict && strict.charCodeAt(0) === 0xfeff) return strict.slice(1);
  if (strict) return strict;
  const decoded = new TextDecoder(encoding, { fatal: false }).decode(sample);
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
