export const stream_type = {
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

export const ContentTypes: (keyof typeof stream_type)[] = [
  'unknown',
  'audio',
  'video',
];

export const StreamTypes: (keyof typeof stream_type)[] = [
  'data',
  'mpeg2_video',
  'h264_video',
  'vc1_video',
  'ac3_audio',
  'mpeg2_audio',
  'lpcm_audio',
  'aac_audio',
];

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
  frame_ticks:   number;
  program:       number; // program number (1,2 ...)
  stream_number: number; // stream number in program
  type:          number; // media type / encoding
  stream_id:     number; // MPEG stream id
  content_type:  number; // 1 - audio, 2 - video
  frame_num:     number;
};

export class Stream {
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
  public frame_ticks = 0;   // current time to show frame in ticks (90 ticks = 1 ms, 90000/frame_ticks=fps)
  public frame_num = 0;     // frame count
  private payload: Payload | null = null;

  finalize(): Packet | null {
    const { payload } = this;
    if (payload === null) return null;
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
    return {
      data,
      pts: payload.pts,
      dts: payload.dts,
      frame_ticks: payload.frame_ticks,
      program: this.program,
      stream_number: this.id,
      stream_id: this.stream_id,
      type: this.type,
      content_type: this.content_type,
      frame_num: this.frame_num,
    };
  }

  write(
    mem: DataView, ptr: number, len: number,
    pstart: number, copy: boolean,
  ): Packet | null {
    const { payload } = this;
    let data = new Uint8Array(mem.buffer, mem.byteOffset + ptr, len);
    if (copy) data = data.slice();
    if (pstart || payload === null) {
      // finalize previously accumulated packet
      const packet = this.finalize();
      // start new packet
      this.payload = {
        buffer: [data],
        buflen: len,
        pts: this.last_pts,
        dts: this.dts,
        frame_ticks: this.frame_ticks,
      };
      return packet;
    }
    payload.buffer.push(data);
    payload.buflen += len;

    return null;
  }
}

export function get_stream(pids: Map<number, Stream>, pid: number): Stream {
  let s = pids.get(pid);
  if (!s) { pids.set(pid, s = new Stream()); }
  return s;
}
