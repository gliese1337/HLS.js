function * parseNALUsFromPacket(bytes: Uint8Array): Generator<Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const len = bytes.byteLength - 3;

  let start: number;
  let end = 1;
  do {
    // Check # of sync bytes (0x000001 or 0x00000001)
    end += view.getUint16(end + 1) ? 3 : 4;
    for (start = end; end < len; end++) {
      // Step forward until we hit another 3- or 4-byte header
      if (view.getUint16(end) === 0 &&
        (bytes[end + 2] === 1 || (view.getUint16(end + 2) === 1))) {
        yield bytes.subarray(start, end);
        break;
      }
    }
  } while (end < len);
  // A packet can't end with a header,
  // so one last NAL Unit extends to the end
  yield bytes.subarray(start);
}

export function * parseNALStream(bytes: Uint8Array | Iterable<Uint8Array>): Generator<Uint8Array> {
  if (bytes instanceof Uint8Array) yield * parseNALUsFromPacket(bytes);
  else for (const packet of bytes) yield * parseNALUsFromPacket(packet);
}
