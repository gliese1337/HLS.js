import { parseSPS, SPSInfo } from './SPSParser';
import { StreamData, Packet } from './streamData';

/* Video Helper Functions */

function * parseNALStream(bytes: Uint8Array): Generator<Uint8Array> {
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

export function video_data({ packets }: StreamData): VideoTrack {
  let pps: Uint8Array = null as unknown as Uint8Array;
  let sps: Uint8Array = null as unknown as Uint8Array;

  const samples = [];
  const nalus = [];
    
  let duration = 0;
  let zeroes = 0;
  let frame_sum = 0;
  let frame_count = 0;
  let offset = 0;
  let packet = packets[0]
  for (let i = 1, len = packets.length; i <= len; i++) {
    const next: Packet = packets[i] || { dts: packet.dts, pts: 0, frame_ticks: 0, data: null };
    let size = 0;
    let isIDR = false;

    for (const nalUnit of parseNALStream(packet.data)) {
      switch (nalUnit[0] & 0x1F) {
        case 7:
          sps = nalUnit;
          break;
        case 8:
          pps = nalUnit;
          break;
        case 5:
          isIDR = true;
        default: // eslint-disable-line no-fallthrough
          size += nalUnit.length + 4;
          nalus.push(nalUnit);
      }
    }

    const dts_delta = next.dts - packet.dts;
    samples.push({
      offset, size, isIDR,
      pts: packet.pts,
      dts: packet.dts,
      cts: packet.pts - packet.dts,
      duration: dts_delta,
    });

    if (dts_delta) {
      duration += dts_delta;
      frame_sum += dts_delta;
      frame_count++;
    } else {
      zeroes++;
    }

    offset += size;
    packet = next;
  }

  const frame_rate = Math.round(frame_sum / frame_count);
  duration += zeroes * frame_rate;

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
    data: mergeNALUs(nalus, offset),
  };
}