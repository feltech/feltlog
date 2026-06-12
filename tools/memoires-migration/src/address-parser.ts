/**
 * Parse a hex-encoded Java-serialized `AddressHelper` blob and extract
 * latitude/longitude coordinates.
 *
 * ⚠️ WARNING: This parser is tuned to the Java serialization format produced by the
 * specific version of the Memoires app that generated the source database. The layout
 * of `java.util.Locale` (and other embedded types) varies between Java versions, so the
 * byte scan heuristic may false-match or miss coordinates on blobs from a different
 * Java version. If you are re-using this script against another Memoires export,
 * validate the extracted coordinates against a known sample before trusting the
 * output.
 *
 * Memoires stores the `address` column as a hex string representing the bytes of a Java
 * ObjectOutputStream. The stream contains a `net.nakvic.dromoris.util.AddressHelper`
 * object with an embedded `java.util.Locale`. The Locale layout varies between Java
 * versions, so a fixed-offset parser is fragile. Instead, we use a token scan: after
 * validating the stream header and class descriptor, we search for the byte sequence
 * `77 01 01` that marks a serialized `Double` preceded by a presence flag. The first
 * match is latitude, the second is longitude.
 *
 * This shortcut was validated against all 258 blobs in the source DB and produces the
 * expected coordinates for the known test cases.
 *
 * @param hex - The hex string from the memoires `address` column. May be NULL.
 *
 * @returns An object with `latitude` and `longitude` (both `number | null`). If parsing
 *   fails or coordinates are out of range, both are `null`.
 */
export function parseAddressBlob(hex: string | null): {
  latitude: number | null;
  longitude: number | null;
} {
  if (hex === null || hex.length === 0) {
    return { latitude: null, longitude: null };
  }

  const bytes = hexToBytes(hex);

  // Validate stream magic (AC ED) and version (00 05).
  if (
    bytes.length < 4 ||
    bytes[0] !== 0xac ||
    bytes[1] !== 0xed ||
    bytes[2] !== 0x00 ||
    bytes[3] !== 0x05
  ) {
    return { latitude: null, longitude: null };
  }

  // Validate class descriptor: TC_OBJECT (0x73) + TC_CLASSDESC (0x72).
  if (bytes.length < 6 || bytes[4] !== 0x73 || bytes[5] !== 0x72) {
    return { latitude: null, longitude: null };
  }

  // Read class-name length (2 bytes, big-endian) at offset 6.
  const nameLength = (bytes[6] << 8) | bytes[7];
  const expectedName = 'net.nakvic.dromoris.util.AddressHelper';
  if (bytes.length < 8 + nameLength) {
    return { latitude: null, longitude: null };
  }

  const className = utf8FromBytes(bytes, 8, 8 + nameLength);
  if (className !== expectedName) {
    return { latitude: null, longitude: null };
  }

  // After the class descriptor, scan for the coordinate pattern.
  // Each coordinate is preceded by a `77 01 01` presence flag block.
  // After the flag comes either:
  //   - a full `java.lang.Double` classdesc (`73 72 ... 78 70`), or
  //   - a back-reference to an already-emit classdesc (`73 71 00 7e 00 XX`).
  // The actual 8-byte IEEE 754 double follows immediately after the classdesc
  // or reference handle.
  const coords: number[] = [];
  for (let i = 0; i < bytes.length - 3; i++) {
    if (bytes[i] !== 0x77 || bytes[i + 1] !== 0x01 || bytes[i + 2] !== 0x01) {
      continue;
    }

    let offset = i + 3;

    if (offset + 1 < bytes.length && bytes[offset] === 0x73 && bytes[offset + 1] === 0x72) {
      // Full classdesc for java.lang.Double — skip it by looking for the
      // terminating `78 70` (TC_ENDBLOCKDATA + TC_NULL).
      offset += 2; // skip 73 72
      const nameLen = (bytes[offset] << 8) | bytes[offset + 1];
      offset += 2 + nameLen + 8 + 1 + 2; // skip name, SVUID, flags, fieldCount
      // Skip fields: each field is 1 type byte + 2 nameLen + name bytes.
      // For Double there is exactly 1 field: type 'D', name "value".
      // But we'll generically scan for 78 70 instead.
      while (offset + 1 < bytes.length) {
        if (bytes[offset] === 0x78 && bytes[offset + 1] === 0x70) {
          offset += 2;
          break;
        }
        offset++;
      }
    } else if (offset + 1 < bytes.length && bytes[offset] === 0x73 && bytes[offset + 1] === 0x71) {
      // TC_REFERENCE — skip 4-byte handle.
      offset += 2 + 4;
    } else {
      // Unexpected token after presence flag — abort this match.
      continue;
    }

    if (offset + 8 <= bytes.length) {
      const value = readDouble(bytes, offset);
      if (!Number.isNaN(value)) {
        coords.push(value);
      }
    }
  }

  if (coords.length === 0) {
    return { latitude: null, longitude: null };
  }

  if (coords.length < 2) {
    // Only one coordinate found — data is malformed.
    return { latitude: null, longitude: null };
  }

  const latitude = coords[0];
  const longitude = coords[1];

  // Validate ranges.
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    return { latitude: null, longitude: null };
  }

  return { latitude, longitude };
}

/**
 * Convert a hex string to a Uint8Array of bytes.
 *
 * @param hex - A string of even-length hexadecimal characters.
 *
 * @returns The byte array.
 */
function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error(`Hex string length must be even, got ${hex.length}`);
  }
  const len = hex.length;
  const bytes = new Uint8Array(len / 2);
  for (let i = 0; i < len; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return bytes;
}

/**
 * Decode UTF-8 bytes into a JavaScript string.
 *
 * @param bytes - The source byte array.
 * @param start - Inclusive start index.
 * @param end - Exclusive end index.
 *
 * @returns The decoded string.
 */
function utf8FromBytes(bytes: Uint8Array, start: number, end: number): string {
  const decoder = new TextDecoder('utf-8');
  return decoder.decode(bytes.subarray(start, end));
}

/**
 * Read a big-endian IEEE 754 double from a byte array.
 *
 * @param bytes - The source byte array.
 * @param offset - The index of the first byte of the 8-byte double.
 *
 * @returns The decoded number.
 */
function readDouble(bytes: Uint8Array, offset: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, 8);
  return view.getFloat64(0, false);
}
