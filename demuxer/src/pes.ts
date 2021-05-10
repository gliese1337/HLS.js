import { Packet, Stream, stream_type } from "./stream";

const SHIFT_29 = 2 ** 29;
function decode_ts(mem: DataView, p: number): number {
  // A multiply by a power of 2 is required for the
  // highest-order bits rather than a shift to avoid
  // downcasting to a 32-bit signed integer, which would
  // cause overflow. The lower bits which will fit in a
  // 31-bit integer can be composed with bitwise
  // operations, and then added to the high-bit integer.
  return ((mem.getUint8(p)  & 0xe ) * SHIFT_29) + (
         ((mem.getUint8(p + 1) & 0xff) << 22) |
         ((mem.getUint8(p + 2) & 0xfe) << 14) |
         ((mem.getUint8(p + 3) & 0xff) << 7) |
         ((mem.getUint8(p + 4) & 0xfe) >> 1)
  );
}

export function decode_pes(
  mem: DataView, ptr: number, len: number,
  s: Stream, pstart: number,
  cb: (p: Packet) => void, copy: boolean,
): number {
  // PES (Packetized Elementary Stream)
  start: if (pstart) {

    // PES header
    if (len < 6) { return 21; } // Incomplete PES Packet Header
    if (mem.getUint16(ptr) !== 0 || mem.getUint8(ptr + 2) !== 1) {
      return 22; // Invalid PES Header
    }

    const stream_id = mem.getUint8(ptr + 3);
    let l = mem.getUint16(ptr + 4);

    ptr += 6;
    len -= 6;

    if ( (stream_id < 0xbd || stream_id > 0xfe) ||
         (stream_id > 0xbf && stream_id < 0xc0) ||
         (stream_id > 0xdf && stream_id < 0xe0) ||
         (stream_id > 0xef && stream_id < 0xfa) ) {

      s.stream_id = 0;
      break start;
    }

    // PES header extension
    if (len < 3) { return 23; } // PES Packet Not Long Enough for Extended Header

    const bitmap = mem.getUint8(ptr + 1);
    const hlen = mem.getUint8(ptr + 2) + 3;
    if (len < hlen) { return 24; } // PES Header Overflows File Length
    if (l > 0) { l -= hlen; }

    switch (bitmap & 0xc0) {
      case 0x80: {  // PTS only
        if (hlen < 8) { break; }
        const pts = decode_ts(mem, ptr + 3);

        if (s.has_dts && pts !== s.dts) { s.frame_ticks = pts - s.dts; }
        if (pts > s.last_pts || !s.has_pts) { s.last_pts = pts; }

        if (s.first_pts === 0 && s.frame_num === (s.content_type === stream_type.video ? 1 : 0)) {
          s.first_pts = pts;
        }

        s.dts = pts;
        s.has_dts = true;
        s.has_pts = true;
        break;
      }
      case 0xc0: {  // PTS,DTS
        if (hlen < 13) { break; }
        const pts = decode_ts(mem, ptr + 3);
        const dts = decode_ts(mem, ptr + 8);

        if (s.has_dts && dts > s.dts) { s.frame_ticks = dts - s.dts; }
        if (pts > s.last_pts || !s.has_pts) { s.last_pts = pts; }

        if (s.first_pts === 0 && s.frame_num === (s.content_type === stream_type.video ? 1 : 0)) {
          s.first_pts = pts;
        }

        s.dts = dts;
        s.has_dts = true;
        s.has_pts = true;
        break;
      }
    }

    ptr += hlen;
    len -= hlen;

    s.stream_id = stream_id;
    s.frame_num++;
  }

  if (s.stream_id && s.content_type !== stream_type.unknown) {
    const packet = s.write(mem, ptr, len, pstart, copy);
    if (packet) cb(packet);
  }

  return 0;
}