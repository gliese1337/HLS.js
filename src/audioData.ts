import { StreamData } from "./TSDemuxer";

const sampleRates = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000, 7350,
];

export type AudioSampleInfo = {
  size: number;
}

export type AudioTrack = {
  type: 'audio';
  profileMinusOne: number;
  channelConfig: number;
  samplingFreqIndex: number;
  maxAudioSize: number;
  maxBitrate: number;
  avgBitrate: number;
  samples: AudioSampleInfo[];
  duration: number;
  byte_offset: number;
  data: Uint8Array;
};

export function audio_data(stream: StreamData): AudioTrack {
  const audioSize = stream.byteLength;
  const audioBuffer = new Uint8Array(audioSize);
  const audioView = new DataView(audioBuffer.buffer);
  let woffset = 0;
  let roffset = 0;

  // Copy PES payloads into a single continuous buffer
  // This accounts for more than one ADTS packet per PES packet,
  // as well as the possibility of ADTS packets split across PES packets
  for (const { data } of stream.packets) {
    audioBuffer.set(data, woffset);
    woffset += data.byteLength;
  }

  // Save 2 bytes of the first header to extract metadata
  const header = audioView.getUint32(2);

  const samples: { size: number }[] = [];
  let maxAudioSize = 0;

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
        roffset + header_length,
        roffset + packet_length
      ), woffset
    );

    roffset += packet_length;
    woffset += data_length;
    samples.push({size: data_length});
    if (maxAudioSize < data_length) {
      maxAudioSize = data_length;
    }
  }

  const frames = samples.length;
  const freqIndex = (header >> 26) & 0xf;
  const duration = frames * 1024 / sampleRates[freqIndex];

  return {
    type: 'audio',
    profileMinusOne: (header >>> 30),
    channelConfig: (header >> 22) & 0x7,
    samplingFreqIndex: freqIndex,
    maxAudioSize: maxAudioSize,
    maxBitrate: Math.round(maxAudioSize / (duration / frames)),
    avgBitrate: Math.round(woffset / duration),
    samples: samples,
    duration: Math.round(90000 * duration),
    byte_offset: 0,
    data: audioBuffer.subarray(0, woffset),
  };
}