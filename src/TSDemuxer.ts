/* Anton Burdinuk's C++ version:
 * https://github.com/clark15b/tsdemuxer/blob/67a20b47dd4a11282134ee61d390cc64d1083e61/v1.0/tsdemux.cpp
 */

const PACKET_LEN = 188;

export const ErrCodes = [
  "",
  "Error 1: Incomplete TS Packet",
  "Error 2: Invalid Sync Byte",
  "Error 3: Transport Error",
  "Error 4: Packet Scrambled",
  "Error 5: Adaptation Field Overflows File Length",
  "Error 6: Incomplete PES Packet (Possibly PAT)",
  "Error 7: Incomplete PAT",
  "Error 8: Invalid PAT Header",
  "Error 9: PAT Overflows File Length",
  "Error 10: PAT Body Isn't a Multiple of the Entry Size (32 bits)",
  "Error 11: Invalid PAT Entry",
  "Error 12: Incomplete PES Packet (Possibly PMT)",
  "Error 13: Incomplete PMT",
  "Error 14: Invalid PMT Header",
  "Error 15: PMT Length Too Large",
  "Error 16: PMT Doesn't Start at Beginning of TS Packet Payload",
  "Error 17: Program Info Oveflows PMT Length",
  "Error 18: Incomplete Elementary Stream Info",
  "Error 19: Invalid Elementary Stream Header",
  "Error 20: Elementary Stream Data Overflows PMT",
  "Error 21: Incomplete PES Packet Header",
  "Error 22: Invalid PES Header",
  "Error 23: PES Packet Not Long Enough for Extended Header",
  "Error 24: PES Header Overflows File Length",
];

const stream_type = {
  unknown     : 0,
  audio       : 1,
  video       : 2,

  // http://en.wikipedia.org/wiki/Program-specific_information#Elementary_stream_types
  data        : 0,
  mpeg2_video : 1,
  h264_video  : 2,
  vc1_video   : 3,
  ac3_audio   : 4,
  mpeg2_audio : 5,
  lpcm_audio  : 6,
  aac_audio   : 7,
};

type Payload = {
  buffer: Uint8Array[];
  buflen: number;
  pts: number;
  dts: number;
  frame_ticks: number;
};

export type Packet = {
  data: Uint8Array;
  pts: number;
  dts: number;
  frame_ticks: number;
};

class Stream {
  public program = 0xffff;  // program number (1,2 ...)
  public id = 0;            // stream number in program
  public type = 0xff;
  public stream_id = 0;     // MPEG stream id
  public content_type = 0;  // 1 - audio, 2 - video
  public dts = 0;           // current MPEG stream DTS (presentation time for audio, decode time for video)
  public has_dts = false;
  public first_pts = 0;
  public last_pts = 0;
  public has_pts = false;
  public frame_ticks = 0;    // current time to show frame in ticks (90 ticks = 1 ms, 90000/frame_ticks=fps)
  public frame_num = 0;     // frame count
  public packets: Packet[] = [];
  public byteLength = 0;
  public payload: Payload | null = null;

  get fps(): number { return 90000 / this.frame_ticks; }
  get length(): number {
    return (this.last_pts + this.frame_ticks - this.first_pts) / 90000;
  }

  finalize(): void {
    const { payload } = this;
    if (payload === null) return;
    let data: Uint8Array;
    if (payload.buffer.length === 1) {
      data = payload.buffer[0];
    } else {
      data = new Uint8Array(payload.buflen);  
      let offset = 0;
      for (const b of payload.buffer) {
        data.set(b, offset);
        offset += b.byteLength;
      }
    }
    this.packets.push({
      data,
      pts: payload.pts,
      dts: payload.dts,
      frame_ticks: payload.frame_ticks,
    });
  }

  write(mem: DataView, ptr: number, len: number, pstart: number, copy: boolean): void {
    const { payload } = this;
    let data = new Uint8Array(mem.buffer, mem.byteOffset + ptr, len);
    if (copy) data = data.slice();
    if (pstart || payload === null) {
      // finalize previously accumulated packet
      this.finalize();
      // start new packet
      this.payload = {
        buffer: [data],
        buflen: len,
        pts: this.last_pts,
        dts: this.dts,
        frame_ticks: this.frame_ticks,
      };
    } else {
      payload.buffer.push(data);
      payload.buflen += len;
    }
    this.byteLength += len;
  }
}

class PMT {
  public mem = new DataView(new ArrayBuffer(512));
  public ptr = 0;
  public len = 0;
  public offset = 0;

  reset(l: number): void {
    this.len = l;
    this.offset = 0;
  }
}

function get_stream(pids: Map<number, Stream>, pid: number): Stream {
  if (!pids.has(pid)) { pids.set(pid, new Stream()); }
  return pids.get(pid) as Stream;
}

function get_stream_type(type_id: number): number {
  switch (type_id) {
  case 0x01:
  case 0x02:
    return stream_type.mpeg2_video;
  case 0x80:
    return stream_type.mpeg2_video;
  case 0x1b:
    return stream_type.h264_video;
  case 0xea:
    return stream_type.vc1_video;
  case 0x81:
  case 0x06:
    return stream_type.ac3_audio;
  case 0x03:
  case 0x04:
    return stream_type.mpeg2_audio;
  case 0x0f:
    return stream_type.aac_audio;
  }

  return stream_type.data;
}

const tlist = [
  stream_type.unknown, stream_type.video, stream_type.video, stream_type.video,
  stream_type.audio, stream_type.audio, stream_type.audio, stream_type.audio,
];

function get_media_type(type_id: number): number {
  return tlist[get_stream_type(type_id)];
}

function decode_ts(mem: DataView, p: number): number {
  return ((mem.getUint8(p)  & 0xe ) << 29) |
         ((mem.getUint8(p + 1) & 0xff) << 22) |
         ((mem.getUint8(p + 2) & 0xfe) << 14) |
         ((mem.getUint8(p + 3) & 0xff) << 7) |
         ((mem.getUint8(p + 4) & 0xfe) >> 1);
}

function decode_pat(mem: DataView, ptr: number, len: number, pids: Map<number, Stream>, pstart: number): number {
  if (pstart) {
    if (len < 1) { return 6; }
    ptr += 1; // skip pointer field
    len -= 1;
  }

  //check table ID
  if (mem.getUint8(ptr) !== 0x00) { return 0; } // not a PAT after all
  if (len < 8) { return 7; }

  // check flag bits and length
  let l = mem.getUint16(ptr + 1);
  if ((l & 0xb000) !== 0xb000) { return 8; } // invalid header

  l &= 0x0fff;
  len -= 3;

  if (l > len) { return 9; }

  len -= 5;
  ptr += 8;
  l -= 5 + 4;

  if (l % 4) { return 10; }

  const n = l / 4;
  for (let i = 0;i < n;i++) {
    const program = mem.getUint16(ptr);
    let pid = mem.getUint16(ptr + 2);

    // 3 reserved bits should be on
    if ((pid & 0xe000) !== 0xe000) { return 11; }

    pid &= 0x1fff;
    ptr += 4;

    const s = get_stream(pids, pid);
    s.program = program;
    s.type = 0xff;
  }

  return 0;
}

function memcpy(
  dstm: DataView, dstp: number,
  srcm: DataView, srcp: number,
  len: number,
): void {
  const dsta = new Uint8Array(dstm.buffer, dstm.byteOffset + dstp, len);
  const srca = new Uint8Array(srcm.buffer, srcm.byteOffset + srcp, len);
  dsta.set(srca);
}

function decode_pmt(
  pmt: PMT,
  mem: DataView, ptr: number, len: number,
  pids: Map<number, Stream>,
  s: Stream,
  pstart: number,
): number {
  if (pstart) {
    if (len < 1) { return 12; }

    ptr += 1;     // skip pointer field
    len -= 1;

    if (mem.getUint8(ptr) !== 0x02) { return 0; } // not a PMT after all
    if (len < 12) { return 13; }

    // check flag bits and length
    let l = mem.getUint16(ptr + 1);
    if ((l & 0x3000) !== 0x3000) { return 14; } // invalid header

    l = (l & 0x0fff) + 3;
    if (l > 512) { return 15; }

    pmt.reset(l);

    if (len < l) l = len;
    memcpy(pmt.mem, pmt.ptr, mem, ptr, l);
    pmt.offset += l;

    if (pmt.offset < pmt.len) { return 0; } // wait for next part
  } else {
    if (!pmt.offset) { return 16; }

    let l = pmt.len - pmt.offset;
    if (len < l) l = len;
    memcpy(pmt.mem, pmt.ptr + pmt.offset, mem, ptr, l);
    pmt.offset += l;

    if (pmt.offset < pmt.len) { return 0; } // wait for next part
  }

  let { ptr: pmt_ptr, len: l } = pmt;
  const pmt_mem = pmt.mem;
  const n = (pmt_mem.getUint16(pmt_ptr + 10) & 0x0fff) + 12;
  if (n > l) { return 17; }

  pmt_ptr += n;
  l -= n + 4;

  while (l) {
    if (l < 5) { return 18; }

    const type = pmt_mem.getUint8(pmt_ptr);
    let pid = pmt_mem.getUint16(pmt_ptr + 1);
    if ((pid & 0xe000) !== 0xe000) { return 19; } // invalid flag bits

    pid &= 0x1fff;
    const ll = (pmt_mem.getUint16(pmt_ptr + 3) & 0x0fff) + 5;
    if (ll > l) { return 20; }

    pmt_ptr += ll;
    l -= ll;

    const ss = get_stream(pids, pid);
    if (ss.program !== s.program || ss.type !== type) {
      ss.program = s.program;
      ss.type = type;
      ss.id = ++s.id;
      ss.content_type = get_media_type(type);
    }
  }

  return 0;
}

function decode_pes(mem: DataView, ptr: number, len: number, s: Stream, pstart: number, copy: boolean): number {
  // PES (Packetized Elementary Stream)
  start: if (pstart) {

    // PES header
    if (len < 6) { return 21; }
    if (mem.getUint16(ptr) !== 0 || mem.getUint8(ptr + 2) !== 1) {
      return 22;
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
    if (len < 3) { return 23; }

    const bitmap = mem.getUint8(ptr + 1);
    const hlen = mem.getUint8(ptr + 2) + 3;
    if (len < hlen) { return 24; }
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
    s.write(mem, ptr, len, pstart, copy);
  }

  return 0;
}

function demux_packet(pmt: PMT, mem: DataView, ptr: number, pids: Map<number, Stream>, copy: boolean): number {
  if (mem.getUint8(ptr) !== 0x47) { return 2; } // invalid packet sync byte

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

  if (flags & 0x20) { // skip adaptation field
    const l = mem.getUint8(ptr) + 1;
    if (l > len) { return 5; }

    ptr += l;
    len -= l;
  }

  if (!pid) {
    return decode_pat(mem, ptr, len, pids, payload_start);
  }

  const s = get_stream(pids, pid);
  if (s.program === 0xffff) { return 0; }
  if (s.type === 0xff) {
    return decode_pmt(pmt, mem, ptr, len, pids, s, payload_start);
  }
  return decode_pes(mem, ptr, len, s, payload_start, copy);
}

export type StreamData = {
  type: number;
  packets: Packet[];
  byteLength: number;
  length: number;
};

export function programs2streams(pids: Map<number, Stream>): Map<number, StreamData> {
  const streams = new Map<number, StreamData>();
  for (const s of pids.values()) {
    s.finalize();
    if (s.byteLength === 0) continue;
    streams.set(s.stream_id, {
      type: s.type,
      packets: s.packets,
      byteLength: s.byteLength,
      length: s.length,
    });
  }

  return streams;
}

/*function toHex(b: Uint8Array): string {
  const a: string[] = [];
  for (const n of b) {
    a.push((n >>> 4).toString(16), (n & 0xf).toString(16)); 
  }
  return a.join('');
}*/

export class TSDemuxer {
  private pmt = new PMT();
  private leftover = new Uint8Array(PACKET_LEN);
  private lview = new DataView(this.leftover.buffer);
  private ptr = 0;
  public readonly pids = new Map<number, Stream>();

  process(buffer: Uint8Array, offset = 0, len = buffer.length - offset): number {
    const { pmt, pids } = this;
    const remainder = (PACKET_LEN - this.ptr) % PACKET_LEN;

    // If we ended on a partial packet last
    // time, finish that packet first.
    if (remainder > 0) {
      if (len < remainder) {
        this.leftover.set(buffer.subarray(offset, offset + len), this.ptr);
        return 1; // still have an incomplete packet
      }

      this.leftover.set(buffer.subarray(offset, offset + remainder), this.ptr);
      const n = demux_packet(pmt, this.lview, 0, pids, true);
      if (n) return n; // invalid packet
    }

    len += offset;
    offset += remainder;

    // Process remaining packets in this chunk
    const mem = new DataView(buffer.buffer, buffer.byteOffset);
    for (let ptr = offset;;ptr += PACKET_LEN) {
      const datalen = len - ptr;
      this.ptr = datalen;
      if (datalen === 0) return 0; // complete packet
      if (datalen < PACKET_LEN) {
        this.leftover.set(buffer.subarray(ptr, ptr + datalen));
        return 1; // incomplete packet
      }

      const n = demux_packet(pmt, mem, ptr, pids, false);
      if (n) return n // invalid packet
    }
  }
}