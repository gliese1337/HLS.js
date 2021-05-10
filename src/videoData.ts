import { parseSPS, SPSInfo } from './SPSParser';
import { Packet } from './streamData';

// Merge NAL Units from all packets into a single
// continuous buffer, separated by 4-byte length headers
function mergeNALUs(nalus: Uint8Array[], length: number): Uint8Array {
  const arr = new Uint8Array(length);
  const view = new DataView(arr.buffer);
  for (let i = 0, offset = 0; offset < length; i++) {
    const unit = nalus[i];
    view.setUint32(offset, unit.byteLength);
    arr.set(unit, offset + 4);
    offset += unit.byteLength + 4;
  }
  return arr;
}

export type VideoSampleInfo = {
  offset: number;
  size: number;
  isIDR: boolean;
  pts: number;
  dts: number;
  cts: number;
  duration: number;
};

export type VideoTrack = {
  type: 'video';
  pps: Uint8Array;
  sps: Uint8Array;
  spsInfo: SPSInfo;
  width: number;
  height: number;
  samples: VideoSampleInfo[];
  duration: number;
  byte_offset: number;
  data: Uint8Array;
};

export class VideoStream {
  private last_packet: Packet | null = null;
  private nalus: Uint8Array[] = [];
  private pps: Uint8Array = null as unknown as Uint8Array;
  private sps: Uint8Array = null as unknown as Uint8Array;
  private samples: VideoSampleInfo[] = [];
  private duration = 0;
  private frame_sum = 0;
  private frame_count = 0;
  private zeroes = 0;

  public byteLength = 0;

  process(packet: Packet) {
    if (!this.last_packet) {
      this.last_packet = packet;
      return;
    }

    const { nalus } = this;
    const next = packet;
    packet = this.last_packet;

    let size = 0;
    let isIDR = false;

    for (const nalUnit of parseNALStream(packet.data)) {
      switch (nalUnit[0] & 0x1F) {
        case 7:
          this.sps = nalUnit;
          break;
        case 8:
          this.pps = nalUnit;
          break;
        case 5:
          isIDR = true;
        default: // eslint-disable-line no-fallthrough
          size += nalUnit.length + 4;
          nalus.push(nalUnit);
      }
    }

    const dts_delta = next.dts - packet.dts;
    this.samples.push({
      size, isIDR,
      offset: this.byteLength,
      pts: packet.pts,
      dts: packet.dts,
      cts: packet.pts - packet.dts,
      duration: dts_delta,
    });

    if (dts_delta) {
      this.duration += dts_delta;
      this.frame_sum += dts_delta;
      this.frame_count++;
    } else {
      this.zeroes++;
    }

    this.byteLength += size;
    this.last_packet = next;
  }

  getTrack(): VideoTrack {
    const {
      frame_count, frame_sum, zeroes,
      samples, sps, pps, nalus, byteLength,
    } = this;
    const frame_rate = Math.round(frame_sum / frame_count);
    const duration = this.duration + zeroes * frame_rate;

    const spsInfo = parseSPS(sps);
    const cropping = spsInfo.frame_cropping;

    return {
      type: 'video',
      pps, sps, spsInfo,
      width: (spsInfo.pic_width_in_mbs * 16)
          - (cropping.left + cropping.right) * 2,
      height: (2 - spsInfo.frame_mbs_only_flag) * (spsInfo.pic_height_in_map_units * 16)
          - (cropping.top + cropping.bottom) * 2,
      samples, duration,
      byte_offset: 0,
      data: mergeNALUs(nalus, byteLength),
    };
  }
}