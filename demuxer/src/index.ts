/* Based on Anton Burdinuk's C++ version:
 * https://github.com/clark15b/tsdemuxer/blob/67a20b47dd4a11282134ee61d390cc64d1083e61/v1.0/tsdemux.cpp
 */

import { demux_packet } from "./packet";
import { PMT } from "./pmt";
import { ContentTypes, Packet, Stream, StreamTypes } from "./stream";
import { ErrCodes, PACKET_LEN, SYNC_BYTE } from "./util";

export { Packet, Stream, StreamTypes, ContentTypes, PACKET_LEN, ErrCodes };

export type DemuxOptions = {
  copy?: boolean;
  pts_reset?: (s: Stream, pts: number) => number,
}

// called when pts < s.last_pts
function pts_reset(s: Stream, _pts: number): number {
  s.last_pts += s.frame_ticks;
  return 0;
}

export class TSDemuxer {
  private pmt = new PMT();
  private leftover = new Uint8Array(PACKET_LEN);
  private lview = new DataView(this.leftover.buffer);
  private ptr = 0;
  private copy: boolean;
  private pts_reset: (s: Stream, pts: number) => number;

  // holds the offset into the input buffer
  // at which the last packet demuxing attempt
  // was made in the event of a error.
  public offset = 0;
  public readonly pids = new Map<number, Stream>();

  constructor(private cb: (p: Packet) => void, opts?: DemuxOptions) {
    this.copy = !!(opts?.copy);
    this.pts_reset = opts?.pts_reset || pts_reset;
  }

  // Find the start of the next packet in a buffer
  static resync(buffer: Uint8Array, offset = 0): number {
    const l = buffer.length;
    for (; offset < l; offset++) {
      if (buffer[offset] === SYNC_BYTE) { return offset; }
    }
    return -1;
  }

  process(buffer: Uint8Array, offset = 0, len = buffer.length - offset): number {
    const { pmt, pids, cb, copy } = this;
    // remainder indicates how many bytes we need to add
    // to the leftovers to get a complete packet.
    // Modulus operation ensures that if this.ptr = 0
    // (i.e., there are no leftover), then remainder = 0;
    const remainder = (PACKET_LEN - this.ptr) % PACKET_LEN;

    // If we ended on a partial packet last
    // time, finish that packet first.
    if (remainder > 0) {
      if (len < remainder) {
        // Add new data to the leftovers,
        // but we still have an incomplete packet.
        this.leftover.set(buffer.subarray(offset, offset + len), this.ptr);
        this.ptr += len;
        this.offset = 0;
        return 1; // incomplete packet
      }

      this.leftover.set(buffer.subarray(offset, offset + remainder), this.ptr);
      this.ptr = 0;
      this.offset = offset;
      const n = demux_packet(pmt, this.lview, 0, pids, cb, true, this.pts_reset);
      if (n) { return n; } // invalid packet
    }

    len += offset;
    offset += remainder;
    this.offset = 0;

    // Process remaining packets in this chunk
    const mem = new DataView(buffer.buffer, buffer.byteOffset);
    for (let ptr = offset;;ptr += PACKET_LEN) {
      const datalen = len - ptr;
      this.ptr = datalen;
      if (datalen === 0) { return 0; } // ended on a complete packet
      if (datalen < PACKET_LEN) { // insufficient data for another complete packet
        this.leftover.set(buffer.subarray(ptr, ptr + datalen));
        return 1; // incomplete packet
      }

      // process one complete packet
      const n = demux_packet(pmt, mem, ptr, pids, cb, copy, this.pts_reset);
      if (n) {
        this.ptr = 0;
        this.offset = ptr; 
        return n; // invalid packet
      }
    }
  }

  finalize(): void {
    const { pids, cb } = this;
    for (const s of pids.values()) {
      const packet = s.finalize();
      if (packet) { cb(packet); }
    }
  }
}