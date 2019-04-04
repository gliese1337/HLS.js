/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Video Helper Functions */
"use strict";

function parseNALStream(bytes) {
  'use strict';
  const view = new DataView(bytes.buffer, bytes.byteOffset);
  const len = bytes.byteLength - 3;
  const nalUnits = [];

  let end = 1;
  do {
    // Check # of sync bytes (0x000001 or 0x00000001)
    end += view.getUint16(end + 1) ? 3 : 4;
    for(let start = end; end < len; end++){
      // Step forward until we hit another 3- or 4-byte header
      if(view.getUint16(end) === 0 &&
        (bytes[end+2] === 1 || (view.getUint16(end+2) === 1))){
        nalUnits.push(bytes.subarray(start, end));
        break;
      }
    }
  } while(end < len);

  // A packet can't end with a header,
  // so one last NAL Unit extends to the end
  nalUnits.push(bytes.subarray(start));

  return nalUnits;
}

// Merge NAL Units from all packets into a single
// continuous buffer, separated by 4-byte length headers
function mergeNALUs(nalus, length) {
  const arr = new Uint8Array(length);
  const view = new DataView(arr.buffer);
  for(let i = 0, offset = 0; offset < length; i++){
    const unit = nalus[i];
    view.setUint32(offset, unit.byteLength);
    arr.set(unit, offset+4);
    offset += unit.byteLength + 4;
  }
  return arr;
}

function video_data(stream) {
  const packets = stream.packets;
  const samples = [];
  const nalus = [];

  let packet = packets[0];
  let offset = 0;
  let zeroes = 0;
  let frame_sum = 0;
  let frame_count = 0;

  let sps = null;
  let pps = null;

  for(let i = 1, len = packets.length; i <= len; i++) {
    const next = packets[i] || { offset, dts: packet.dts };
    let size = 0;
    let isIDR = false;

    for (const nalUnit of parseNALStream(packet.data)) {
      switch(nalUnit[0] & 0x1F) {
        case 7:
          sps = nalUnit;
          break;
        case 8:
          pps = nalUnit;
          break;
        case 5:
          isIDR = true;
        default: /* falls through */
          size += nalUnit.length+4;
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

    if(dts_delta){
      frame_sum += dts_delta;
      frame_count++;
    }else{
      zeroes++;
    }

    offset += size;
    packet = next;
  }

  const frame_rate = Math.round(frame_sum / frame_count);
  const duration = frame_sum + zeroes * frame_rate;
  const spsInfo = parseSPS(sps);
  const cropping = spsInfo.frame_cropping;

  return {
    type: 'video',
    pps, sps, spsInfo,
    samples, duration,
    width: (spsInfo.pic_width_in_mbs * 16)
        - (cropping.left + cropping.right) * 2,
    height: (2 - spsInfo.frame_mbs_only_flag) * (spsInfo.pic_height_in_map_units * 16)
        - (cropping.top + cropping.bottom) * 2,
    data: mergeNALUs(nalus, offset)
  };
}

const sampleRates = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000, 7350
];

function audio_data(stream) {
  const audioSize = stream.byteLength;
  const audioBuffer = new Uint8Array(audioSize);
  const audioView = new DataView(audioBuffer.buffer);
  const samples = [];
  
  let maxAudioSize = 0;
  let woffset = 0;
  let roffset = 0;

  // Copy PES payloads into a single continuous buffer
  // This accounts for more than one ADTS packet per PES packet,
  // as well as the possibility of ADTS packets split across PES packets
  for (const packet of stream.packets) {
    audioBuffer.set(packet.data, woffset);
    woffset += packet.data.byteLength;
  }

  // Save 2 bytes of the first header to extract metadata
  const header = audioView.getUint32(2);

  // Shift ADTS payloads in the buffer to eliminate intervening headers
  for (woffset = 0; roffset < audioSize;) {
    const header_length = (audioView.getUint8(roffset + 1) & 1) ? 7 : 9;
    const packet_length = (audioView.getUint32(roffset + 2) >> 5) & 0x1fff;
    const data_length = packet_length - header_length;

    // Empirically, there's always 1 AAC/ADTS frame,
    // and frequency is constant per stream segment
    //console.log("AAC frames per ADTS frame:", (audioView.getUint8(roffset+6) & 3) + 1);
    //console.log("Sampling Frequency:", (audioView.getUint8(roffset+2) >> 2) & 0xf);

    audioBuffer.set(
      audioBuffer.subarray(
        roffset+header_length,
        roffset+packet_length
      ), woffset
    );

    roffset += packet_length;
    woffset += data_length;
    samples.push({ size: data_length });
    if(maxAudioSize < data_length){
      maxAudioSize = data_length;
    }
  }

  const frames = samples.length;
  const freqIndex = (header >> 26) & 0xf;
  const duration = frames * 1024 / sampleRates[freqIndex];

  return {
    type: 'audio',
    samples, maxAudioSize,
    profileMinusOne: (header >>> 30),
    channelConfig: (header >> 22) & 0x7,
    samplingFreqIndex: freqIndex,
    maxBitrate: Math.round(maxAudioSize / (duration / frames)),
    avgBitrate: Math.round(woffset / duration),
    duration: Math.round(90000 * duration),
    data: audioBuffer.subarray(0,woffset)
  };
}

addEventListener('message', ({ data: { streams, index } }) => {
  const tracks = [];

  if(streams[0xE0]){ tracks.push(video_data(streams[0xE0])); }
  if(streams[0xC0]){ tracks.push(audio_data(streams[0xC0])); }

  const file = MP4.File(tracks).buffer;
  postMessage({ index, file }, [file]);
});
