// Bech32 (BIP-173) for LNURL strings (LUD-01). An LNURL is the bech32 encoding of a URL, with the prefix lnurl.
// BIP-173 limits a string to 90 characters, but LUD-01 has no limit. Thus this code has no limit.
// Spec: https://github.com/bitcoin/bips/blob/master/bip-0173.mediawiki
const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATOR = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const CHECKSUM_LENGTH = 6;

function polymod(values: number[]): number {
  let checksum = 1;
  for (const value of values) {
    const top = checksum >>> 25;
    checksum = ((checksum & 0x1ffffff) << 5) ^ value;
    for (let bit = 0; bit < 5; bit++) if ((top >>> bit) & 1) checksum ^= GENERATOR[bit];
  }
  return checksum;
}

function expandPrefix(prefix: string): number[] {
  const codes = [...prefix].map((char) => char.charCodeAt(0));
  return [...codes.map((code) => code >>> 5), 0, ...codes.map((code) => code & 31)];
}

// Converts groups of fromBits bits to groups of toBits bits. With pad, zero bits fill the last group.
// Without pad, the last bits must be fewer than fromBits, and they must all be zero.
function convertBits(values: Iterable<number>, fromBits: number, toBits: number, pad: boolean): number[] {
  const max = (1 << toBits) - 1;
  const result: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const value of values) {
    accumulator = ((accumulator << fromBits) | value) & 0xffff;
    bits += fromBits;
    for (; bits >= toBits; bits -= toBits) result.push((accumulator >>> (bits - toBits)) & max);
  }
  if (pad && bits > 0) result.push((accumulator << (toBits - bits)) & max);
  if (!pad && (bits >= fromBits || (accumulator << (toBits - bits)) & max)) throw new Error('bad padding');
  return result;
}

// Returns the lowercase bech32 string of the UTF-8 bytes of the text.
export function bech32Encode(prefix: string, text: string): string {
  const words = convertBits(new TextEncoder().encode(text), 8, 5, true);
  const checksum = polymod([...expandPrefix(prefix), ...words, ...new Array(CHECKSUM_LENGTH).fill(0)]) ^ 1;
  for (let index = CHECKSUM_LENGTH - 1; index >= 0; index--) words.push((checksum >>> (5 * index)) & 31);
  return `${prefix}1${words.map((word) => CHARSET[word]).join('')}`;
}

// Decodes a lowercase or an uppercase bech32 string. Throws an Error if the string is not valid bech32.
export function bech32Decode(value: string): { prefix: string; text: string } {
  const lower = value.toLowerCase();
  if (value !== lower && value !== value.toUpperCase()) throw new Error('mixed case');
  const separator = lower.lastIndexOf('1');
  if (separator < 1 || lower.length - separator - 1 < CHECKSUM_LENGTH) throw new Error('no prefix or no checksum');
  const prefix = lower.slice(0, separator);
  if ([...prefix].some((char) => char < '!' || char > '~')) throw new Error('bad prefix character');
  const words = [...lower.slice(separator + 1)].map((char) => CHARSET.indexOf(char));
  if (words.includes(-1)) throw new Error('bad data character');
  if (polymod([...expandPrefix(prefix), ...words]) !== 1) throw new Error('bad checksum');
  const bytes = convertBits(words.slice(0, -CHECKSUM_LENGTH), 5, 8, false);
  return { prefix, text: new TextDecoder('utf-8', { fatal: true }).decode(new Uint8Array(bytes)) };
}
