import { get_stream, Stream, stream_type } from "./stream";

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

function get_media_type(type_id: number): number {
  switch (type_id) {
  case 0x01: // mpeg2_video
  case 0x02: // mpeg2_video
  case 0x80: // mpeg2_video
  case 0x1b: // h264_video
  case 0xea: // vc1_video
    return stream_type.video;
  case 0x81: // ac3_audio
  case 0x06: // ac3_audio
  case 0x03: // mpeg2_audio
  case 0x04: // mpeg2_audio
  case 0x0f: // aac_audio
    return stream_type.audio;
  }

  return stream_type.unknown;
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

export class PMT {
  public mem = new DataView(new ArrayBuffer(512));
  public ptr = 0;
  public len = 0;
  public offset = 0;

  reset(l: number): void {
    this.len = l;
    this.offset = 0;
  }

  decode(
    mem: DataView, ptr: number, len: number,
    pids: Map<number, Stream>,
    s: Stream,
    pstart: number,
  ): number {
    if (pstart) {
      if (len < 1) { return 12; } // Incomplete PES Packet (Possibly PMT)

      ptr += 1;     // skip pointer field
      len -= 1;

      if (mem.getUint8(ptr) !== 0x02) { return 0; } // not a PMT after all
      if (len < 12) { return 13; } // Incomplete PMT

      // check flag bits and length
      let l = mem.getUint16(ptr + 1);
      if ((l & 0x3000) !== 0x3000) { return 14; } // Invalid PMT Header

      l = (l & 0x0fff) + 3;
      if (l > 512) { return 15; } // PMT Length Too Large

      this.reset(l);

      if (len < l) l = len;
      memcpy(this.mem, this.ptr, mem, ptr, l);
      this.offset += l;

      if (this.offset < this.len) { return 0; } // wait for next part
    } else {
      if (!this.offset) { return 16; } // PMT Doesn't Start at Beginning of TS Packet Payload

      let l = this.len - this.offset;
      if (len < l) l = len;
      memcpy(this.mem, this.ptr + this.offset, mem, ptr, l);
      this.offset += l;

      if (this.offset < this.len) { return 0; } // wait for next part
    }

    let { ptr: pmt_ptr, len: l } = this;
    const pmt_mem = this.mem;
    const n = (pmt_mem.getUint16(pmt_ptr + 10) & 0x0fff) + 12;
    if (n > l) { return 17; } // Program Info Oveflows PMT Length

    pmt_ptr += n;
    l -= n + 4;

    while (l) {
      if (l < 5) { return 18; } // Incomplete Elementary Stream Info

      let pid = pmt_mem.getUint16(pmt_ptr + 1);
      if ((pid & 0xe000) !== 0xe000) { return 19; } // Invalid Elementary Stream Header

      pid &= 0x1fff;
      const ll = (pmt_mem.getUint16(pmt_ptr + 3) & 0x0fff) + 5;
      if (ll > l) { return 20; } // Elementary Stream Data Overflows PMT
      
      const type = get_stream_type(pmt_mem.getUint8(pmt_ptr));

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
}
