/* Based on Anton Burdinuk's C++ version:
 * https://github.com/clark15b/tsdemuxer/blob/67a20b47dd4a11282134ee61d390cc64d1083e61/v1.0/tsdemux.cpp
 */

import { decode_pat } from "./pat";
import { decode_pes } from "./pes";
import { PMT } from "./pmt";
import { get_stream, Packet, Stream } from "./stream";
import { PACKET_LEN, SYNC_BYTE } from "./util";

export function demux_packet(
  pmt: PMT,
  mem: DataView, ptr: number,
  pids: Map<number, Stream>,
  cb: (p: Packet) => void,
  copy: boolean,
): number {
  if (mem.getUint8(ptr) !== SYNC_BYTE) { return 2; } // invalid packet sync byte

  let pid = mem.getUint16(ptr + 1);
  const flags = mem.getUint8(ptr + 3);

  if (pid & 0x8000) { return 3; } // transport error
  if (flags & 0xc0) { return 4; } // scrambled

  const payload_start = pid & 0x4000;
  pid &= 0x1fff;

  //check if payload exists
  if (pid === 0x1fff || !(flags & 0x10)) { return 0; }

  ptr += 4;
  let len = PACKET_LEN - 4;

  let pcr: number | null = null;

  if (flags & 0x20) { // parse adaptation field
    const adaptationFieldLength = mem.getUint8(ptr);
    if (adaptationFieldLength + 1 > len) { return 5; } // Adaptation Field Overflows File Length

    if (adaptationFieldLength > 0) {
      const adaptationFieldFlags = mem.getUint8(ptr + 1);
      const hasPCR = adaptationFieldFlags & 0x10; // Check if PCR flag is set

      if (hasPCR) {
        const pcrBase = mem.getUint32(ptr + 2) << 1 | (mem.getUint8(ptr + 6) >> 7);
        const pcrExtension = mem.getUint8(ptr + 6) & 0x01;
        pcr = pcrBase * 300 + pcrExtension; // Calculate PCR in 27 MHz units
      }
    }

    ptr += adaptationFieldLength + 1;
    len -= adaptationFieldLength + 1;
  }

  if (!pid) {
    return decode_pat(mem, ptr, len, pids, payload_start);
  }

  const s = get_stream(pids, pid);
  s.pcr = pcr;
  if (s.program === 0xffff) { return 0; }
  if (s.type === 0xff) {
    return pmt.decode(mem, ptr, len, pids, s, payload_start);
  }
  return decode_pes(mem, ptr, len, s, payload_start, cb, copy);
}
