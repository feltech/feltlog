import { parseAddressBlob } from '../src/address-parser.js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Read a hex fixture file from the tests/fixtures directory.
 *
 * @param name - The fixture file name.
 *
 * @returns The hex string contents, trimmed.
 */
function readHexFixture(name: string): string {
  return readFileSync(resolve('tests/fixtures', name), 'utf-8').trim();
}

describe('parseAddressBlob', () => {
  it('returns nulls for a NULL input', () => {
    expect(parseAddressBlob(null)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls for an empty string', () => {
    expect(parseAddressBlob('')).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('parses a 2011-style blob with no coordinates (_id=97)', () => {
    const hex = readHexFixture('sample-blob-without-coords.hex');
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('parses a 2016 blob with coordinates (_id=272)', () => {
    const hex = readHexFixture('sample-blob-with-coords.hex');
    expect(parseAddressBlob(hex)).toEqual({
      latitude: 51.2948759,
      longitude: 1.0749246,
    });
  });

  it('parses a 2022 Burnley blob (_id=330)', () => {
    const hex = readHexFixture('sample-blob-330.hex');
    expect(parseAddressBlob(hex)).toEqual({
      latitude: 53.7866192,
      longitude: -2.2632168,
    });
  });

  it('parses a 2025 Burnley blob (_id=415)', () => {
    const hex = readHexFixture('sample-blob-415.hex');
    expect(parseAddressBlob(hex)).toEqual({
      latitude: 53.7939697,
      longitude: -2.294709,
    });
  });

  it('returns nulls for an invalid hex string', () => {
    expect(parseAddressBlob('deadbeef')).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls when bytes are too short after magic', () => {
    // Magic (4 bytes) + 1 extra byte — not enough for TC_OBJECT + TC_CLASSDESC.
    const hex = 'ACED000501';
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls when TC_OBJECT/TC_CLASSDESC tokens are wrong', () => {
    // Magic correct but bytes[4] and bytes[5] are not 0x73 and 0x72.
    const hex = 'ACED0005DEAD';
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls when blob is too short to read class name length', () => {
    // Magic + TC_OBJECT + TC_CLASSDESC but only 1 byte for name length.
    const hex = 'ACED0005737201';
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls when blob is too short for the full class name', () => {
    // Magic + TC_OBJECT + TC_CLASSDESC + name length = 41 but truncated.
    const hex =
      'ACED0005' +
      '7372' + // TC_OBJECT + TC_CLASSDESC
      '0029' + // name length = 41
      '6E65742E6E616B7669632E64726F6D6F7269732E7574696C2E416464726573'; // only 29 bytes
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls for garbage that passes magic but fails class name', () => {
    // Valid magic + TC_OBJECT + TC_CLASSDESC + short name "XX"
    const hex = 'ACED00057372000258580300007870';
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('returns nulls when only one coordinate is found', () => {
    // Synthetic blob with a valid header but exactly one 77 01 01 + Double.
    // magic + TC_OBJECT + TC_CLASSDESC + name + SVUID + flags + fieldCount +
    // TC_ENDBLOCKDATA + TC_NULL + filler + presence flag + back-reference +
    // 8-byte double.
    const hex =
      'ACED0005' + // stream magic + version
      '7372' + // TC_OBJECT + TC_CLASSDESC
      '0029' + // name length = 41
      '6E65742E6E616B7669632E64726F6D6F7269732E7574696C2E4164647265737348656C706572' +
      '0000000000000001' + // SVUID
      '00' + // flags
      '0000' + // fieldCount = 0
      '7870' + // TC_ENDBLOCKDATA + TC_NULL
      'DEADBEEF' + // filler
      '770101' + // presence flag
      '7371007E0002' + // TC_REFERENCE handle
      '400921FB54442D18'; // π as IEEE 754 double
    expect(parseAddressBlob(hex)).toEqual({
      latitude: null,
      longitude: null,
    });
  });

  it('throws on odd-length hex string', () => {
    expect(() => parseAddressBlob('ABC')).toThrow('Hex string length must be even');
  });
});
