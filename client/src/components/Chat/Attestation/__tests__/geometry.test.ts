import { badgePath, normalizeKey, sealCode, sealStrands } from '../geometry';

const ED25519_KEY = '5a0210f2442c79355784f9de021985429561da5bacc3a4424b01ac52b7e0caff';
const OTHER_KEY = 'c3e91a07bb2d4f6e88a1d0c4f2970b3e5d6a18c9e04f7b2a1c3d5e6f708192a3';
const ECDSA_ADDRESS = '0x19F4bE2207c8D3a6E5b1F0928374a6C5d4E3F2a1';

describe('seal geometry', () => {
  it('prints the first and last four hex digits as the seal code', () => {
    expect(sealCode(ED25519_KEY)).toBe('5A02·CAFF');
    expect(sealCode(ECDSA_ADDRESS)).toBe('19F4·F2A1');
  });

  it('normalizes a 0x-prefixed, mixed-case address', () => {
    expect(normalizeKey(ECDSA_ADDRESS)).toBe('19f4be2207c8d3a6e5b1f0928374a6c5d4e3f2a1');
  });

  it('draws equal strands for equal keys however they are written', () => {
    expect(sealStrands(ED25519_KEY)).toEqual(sealStrands(ED25519_KEY.toUpperCase()));
    expect(sealStrands(ECDSA_ADDRESS)).toEqual(sealStrands(normalizeKey(ECDSA_ADDRESS)));
  });

  it('draws different strands for different keys', () => {
    const one = sealStrands(ED25519_KEY);
    const two = sealStrands(OTHER_KEY);
    expect(one?.band).not.toEqual(two?.band);
    expect(one?.rose).not.toEqual(two?.rose);
  });

  it('draws two bands and three petals as closed paths', () => {
    const strands = sealStrands(ED25519_KEY);
    expect(strands?.band.match(/M/g)).toHaveLength(2);
    expect(strands?.rose.match(/M/g)).toHaveLength(3);
    expect(strands?.band.endsWith('Z')).toBe(true);
  });

  it('refuses a value too short to be a key', () => {
    expect(sealStrands('abcd')).toBeUndefined();
    expect(sealStrands('')).toBeUndefined();
  });

  it('keeps the badge inside its box', () => {
    const coordinates = badgePath(8, 8, 7.25)
      .replace(/[MLZ]/g, ' ')
      .trim()
      .split(/\s+/)
      .map(Number);
    expect(Math.min(...coordinates)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...coordinates)).toBeLessThanOrEqual(16);
  });
});
