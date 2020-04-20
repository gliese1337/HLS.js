/*
 * DataViews on ArrayBuffers are used throughout to construct binary data;
 * this choice was made for the following reasons:
 *
 * 1. There are a lot of zeros in an MP4 file. Declaring binary data with
 *    array literals results in a big blocks of zeroes, and it's nice to
 *    only have to declare the non-zero values.
 * 2. Many box types contain heterogenous, non-aligned data. DataViews
 *    make that relatively easy to deal with. Otherwise, we'd have to do a
 *    *lot* more bitshifting, even if we declared an empty array and just
 *    filled in the non-zero slots.
 * 3. Assigning to typed arrays for types larger than 8 bits provides no
 *    guarantees about endianness. Since bitshifting to stuff things into
 *    Uint8Arrays is a pain, it's a lot easier to just use DataView, which
 *    does guarantee endianness, rather than checking platform endianness.
 */

import { VideoTrack } from './videoData';
import { AudioTrack } from './audioData';

type Track = AudioTrack | VideoTrack;

const boxtypes = new Map<string, number>();

function toInt(s: string){
  let n = 0;
  for (let i = 0, l = s.length; i < l; i++) {
    n = (n << 8) | s.charCodeAt(i);
  }
  return n;
}

type Box = {
  byteLength: number;
  box: Uint8Array[];
};

function box(type: string, ...payload: (Box|Uint8Array)[]): Box{
  let size = 8;
  const header = new Uint8Array(8);
  const view = new DataView(header);
  const box = [header];

  if(!boxtypes.has(type)){
    boxtypes.set(type, toInt(type));
  }

  for (const p of payload) {
    size += p.byteLength;
    if (p instanceof Uint8Array) box.push(p);
    else box.push(...p.box);
  }

  view.setUint32(0, size);
  view.setUint32(4, boxtypes.get(type));

  return { byteLength: size, box };
}

function merge(...boxes: Box[]){
  const size = boxes.reduce((a, n) => a + n.byteLength, 0);
  const arr = new Uint8Array(size);

  let i = 0;
  for (const b of boxes) {
    for (const chunk of b.box) {
      arr.set(chunk, i);
      i += chunk.byteLength;
    }
  }

  return arr;
}

function ftyp(){
  const buffer = new Uint8Array(20);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, 0x69736f6d); //major brand 'isom'
  view.setUint32(4, 1); //minor version
  view.setUint32(8, 0x69736f6d); //isom
  view.setUint32(12, 0x61766331); //avc1
  view.setUint32(16, 0x6d703431); //mp41

  return box('ftyp', buffer);
}

function mdat(tracks: Track[]) {
  return box('mdat', ...tracks.map(track => track.data));
}

/** MOOV SECTION
  moov
    mvhd
    trak
      tkhd
      mdia
        mdhd
        hdlr
        minf
          smhd / vmhd
          dinf > dref
          stbl
            stsd
              mp4a > esds
              avc1 > avcC
            stts
            stsc
            stsz
            stco
            stss
            ctts
**/

function hdlr(track: Track){
  const buffer = new Uint8Array(37);
  const view = new DataView(buffer.buffer);

  if(track.type==='video'){
    view.setUint32(8, 0x76696465); // vide
    view.setUint32(24, 0x56696465); // 'Vide'
    view.setUint32(28, 0x6f48616e); // 'oHan'
  }else{
    view.setUint32(8, 0x736f756e); // soun
    view.setUint32(24, 0x536f756e); // 'Soun'
    view.setUint32(28, 0x6448616e); // 'dHan'
  }

  view.setUint32(32, 0x646c6572); // 'dler'

  return box('hdlr', buffer);
}

function vmhd(){
  const buffer = new Uint8Array(12);
  const view = new DataView(buffer.buffer);
  view.setUint32(0, 1); // version & flags
  // graphicsmode(16) & opcolor(16)[3]
  return box('vmhd', buffer);
}

function smhd(){
  // version & flags, balance & reserved, all zeroes
  return box('smhd', new Uint8Array(8));
}

function dref(){
  const buffer = new Uint8Array(21);
  const view = new DataView(buffer.buffer);

  // flags = 0
  view.setUint32(4, 1); // entry count
  //DataEntryUrl sub-box
  view.setUint32(8, 13);
  view.setUint32(12, 0x75726c20); // 'url '
  view.setUint32(16, 1); // self-contained flag
  //no url string in self-contained version

  return box('dref', buffer);
}

function dinf(){
  return box('dinf', dref());
}

function avcC(track: VideoTrack){
  const { sps, pps, spsInfo } = track;
  const spslen = sps.byteLength;
  const ppslen = pps.byteLength;
  const buffer = new Uint8Array(spslen + ppslen + 11);
  const view = new DataView(buffer.buffer);

  view.setUint8(0, 1); // version
  view.setUint8(1, spsInfo.profile_idc);
  view.setUint8(2, spsInfo.profile_compatibility);
  view.setUint8(3, spsInfo.level_idc);
  view.setUint8(4, 0xff); // 6 bits reserved + lengthSizeMinus1

  view.setUint8(5, 0xe1); // 3 bits reserved + SPS count
  view.setUint16(6, spslen);
  for(let i = 0, j = 8; i < spslen; i++, j++){
    view.setUint8(j, sps[i]);
  }

  view.setUint8(8+spslen, 1); // PPS count
  view.setUint16(9+spslen, ppslen);
  for(let i = 0, j = 11+spslen; i < ppslen; i++, j++){
    view.setUint8(j, pps[i]);
  }

  return box('avcC', buffer);
}

function avc1(track: VideoTrack){
  const buffer = new Uint8Array(78);
  const view = new DataView(buffer.buffer);

  // six bytes reserved
  view.setUint16(6, 1); // data reference index
  // VisualSampleEntry data
  // 4 words / 16 bytes predefined & reserved space, all zeroes
  view.setUint16(24, track.width); // width
  view.setUint16(26, track.height); // height
  view.setUint32(28, 0x00480000); // 72dpi horiz res.
  view.setUint32(32, 0x00480000); // 72dpi vert res.
  // 4 bytes reserved
  view.setUint16(40, 1); // frame count
  // 32 bytes / 8 words of empty compressor name string
  view.setUint16(74, 24); // bit depth
  view.setUint16(76, 0xffff); // predefined

  return box('avc1', buffer, avcC(track));
}

function esds(track: AudioTrack){
  const buffer = new Uint8Array(43);
  const view = new DataView(buffer.buffer);
  const freqIndex = track.samplingFreqIndex;
  const objectType = track.profileMinusOne + 1;
  const channelConf = track.channelConfig;

  //4 bytes version & flags = 0
  //ES_Descriptor
  view.setUint32(4, 0x03808080); // ES_DescrTag, type = 3
  // length(8) = 34, ES_ID(16) = 2, stream priority + flags byte = 0
  view.setUint32(8, 0x22000200);

  //DecoderConfigDescriptor
  view.setUint32(12, 0x04808080); // ES_DescrTag, type = 4
  // length(8) = 20, objectTypeIndication(8) = MPEG4 Audio ISO/IEC 14496-3
  // streamType = 5 (Audio), upStream = 0, reserved = 0, bufferSize = 0
  view.setUint32(16, 0x14401500);
  // 2 more bytes of bufferSize = 0
  view.setUint32(22, track.maxBitrate);
  view.setUint32(26, track.avgBitrate);

  // DecoderSpecificInfo
  view.setUint32(30, 0x05808080); // DecSpecificInfoTag
  view.setUint8(34, 2); // length
  view.setUint16(35, (objectType<<11)|(freqIndex<<7)|(channelConf<<3));

  // SLConfigDescriptor
  view.setUint32(37, 0x06808080); //SLConfigDescrTag
  view.setUint16(41, 0x0102); // length = 1, MP4 = 2

  return box('esds', buffer);
}

function channelCount(conf: number){
  if(conf < 2){ return 1; } // 0 is AOT specific
  if(conf < 7){ return conf; }
  return 8;
}

const sampleRates = [
  96000, 88200, 64000, 48000, 44100, 32000,
  24000, 22050, 16000, 12000, 11025, 8000, 7350
];

function mp4a(track: AudioTrack){
  const buffer = new Uint8Array(28);
  const view = new DataView(buffer.buffer);

  // 6 bytes reserved
  view.setUint16(6, 1); // data reference index
  // AudioSampleEntry data
  // 8 bytes reserved
  view.setUint16(16, channelCount(track.channelConfig));
  view.setUint16(18, 16); // sample size
  // 4 bytes reserved
  view.setUint32(24, sampleRates[track.samplingFreqIndex]<<16);

  // mp4a extends AudioSampleEntry with ESDBox
  return box('mp4a', buffer, esds(track));
}

function stsd(track: Track){
  const buffer = new Uint8Array(8);
  const view = new DataView(buffer.buffer);

  view.setUint32(4, 1); // entry count

  return box('stsd', buffer,
    track.type === 'video'?avc1(track):mp4a(track)
  );
}

function stts(track: VideoTrack){
  // merge runs of identical deltas
  const dts_diffs = [];
  let current: {sample_count: number, sample_delta: number};
  let last_delta = -1;
  for (const sample of track.samples) {
    const delta = sample.duration;
    if(delta !== last_delta){
      current = {sample_count: 1, sample_delta: delta};
      dts_diffs.push(current);
      last_delta = delta;
    }else{
      current.sample_count++;
    }
  }

  const c = dts_diffs.length;
  const buffer = new Uint8Array(c * 8 + 8);
  const view = new DataView(buffer.buffer);

  //version & flags are zero
  view.setUint32(4, c); // entry count

  for(let i=0, j=8; i < c; i++, j+=8){
    view.setUint32(j, dts_diffs[i].sample_count);
    view.setUint32(j+4, dts_diffs[i].sample_delta);
  }

  return box('stts', buffer);
}

function stsz(track: Track){
  const { samples } = track;
  const c = samples.length;
  const buffer = new Uint8Array(c * 4 + 12);
  const view = new DataView(buffer.buffer);

  //version & flags are zero
  //sample_size(32) = 0
  view.setUint32(8, c); // sample count

  for(let i=0, j=12; i < c; i++, j+=4){
    view.setUint32(j, samples[i].size);
  }

  return box('stsz', buffer);
}

function stsc(track: Track){
  const buffer = new Uint8Array(20);
  const view = new DataView(buffer.buffer);

  //version & flags are zero
  view.setUint32(4, 1); // entry count
  view.setUint32(8, 1); // first chunk
  view.setUint32(12, track.samples.length); // sample count
  view.setUint32(16, 1); // sample description index

  return box('stsc', buffer);
}

function stco(track: Track){
  const buffer = new Uint8Array(12);
  const view = new DataView(buffer);

  //version & flags are zero
  view.setUint32(4, 1); // entry count
  view.setUint32(8, track.byte_offset);

  return box('stco', buffer);
}

function stss(track: VideoTrack){
  const indices = track.samples
      .map((s,i) => s.isIDR?i+1:-1)
      .filter(i => i !== -1);
  const c = indices.length;
  const buffer = new Uint8Array(c * 4 + 8);
  const view = new DataView(buffer.buffer);

  //version & flags are zero
  view.setUint32(4, c); // entry count

  for(let i=0, j=8; i < c; i++, j+=4){
    view.setUint32(j, indices[i]);
  }

  return box('stss', buffer);
}

function ctts(track: VideoTrack){
  const pd_diffs = [];
  let last_offset = -1;
  let current: {
    sample_count: number;
    sample_offset: number;
  };

  // Merge runs of equal offsets into a single entry
  for (const s of track.samples) {
    const offset = s.cts;
    if(offset === last_offset){
      current.sample_count++;
    }else{
      last_offset = offset;
      current = {
        sample_count: 1,
        sample_offset: offset
      };
      pd_diffs.push(current);
    }
  }

  const c = pd_diffs.length;
  if(c === 0){ return new Uint8Array(0); }

  const buffer = new Uint8Array(c * 8 + 8);
  const view = new DataView(buffer.buffer);

  //version & flags are zero
  view.setUint32(4, c); // entry count

  for(let i=0, j=8; i < c; i++, j+=8){
    view.setUint32(j, pd_diffs[i].sample_count);
    view.setUint32(j+4, pd_diffs[i].sample_offset);
  }

  return box('ctts', buffer);
}

function stbl(track: Track){
  const subboxes: ((t: any) => (Box|Uint8Array))[] =
    [stsd, stts, stsc, stsz, stco];

  if(track.type === 'video'){
    subboxes.push(stss);
    subboxes.push(ctts);
  }

  return box('stbl', ...subboxes.map(b => b(track)));
}

function minf(track: Track){
  return box('minf',
    (track.type === 'video'?vmhd:smhd)(),
    dinf(), stbl(track)
  );
}

function mdhd(track: Track){
  const buffer = new Uint8Array(24);
  const view = new DataView(buffer.buffer);

  //version & flags = 0
  // creation & modification time = 0
  view.setUint32(12, 90000); // timescale
  view.setUint32(16, track.duration);
  view.setUint32(20, 0x55c40000); // 15-bit 'und' lang code & predefined = 0

  return box('mdhd', buffer);
}

function mdia(track: Track){
  return box('mdia', mdhd(track), hdlr(track), minf(track));
}

function tkhd(track: Track, id: number){
  const buffer = new Uint8Array(84);
  const view = new DataView(buffer.buffer);

  view.setUint32(0, 15); // version & flags
  // creation & modification time = 0
  view.setUint32(12, id);
  view.setUint32(20, track.duration || 0xffffffff);
  // reserved, layer(16) & alternate group(16)
  // set volume at byte 32 later
  // identity matrix:
  view.setUint32(36, 0x01000000);
  view.setUint32(52, 0x00010000);
  view.setUint32(72, 0x40000000);

  if(track.type === 'audio'){
    view.setUint32(32, 0x01000000); // volume & reserved bits
  }else{
    view.setUint32(76, (track.width & 0xffff)<<16);  // 16.16 width, ignoring fractional part
    view.setUint32(80, (track.height & 0xffff)<<16); // 16.16 height, ignoring fractional part
  }

  return box('tkhd', buffer);
}

function trak(track: Track, id: number){
  return box('trak', tkhd(track, id), mdia(track));
}

function mvhd(tracks: Track[]){
  const buffer = new Uint8Array(100);
  const view = new DataView(buffer.buffer);

  const d = Math.max.apply(Math,
    tracks.map(track => track.duration)
  );

  // version & flags = 0
  // creation & modification time = 0
  view.setUint32(12, 90000); // timescale
  view.setUint32(16, d); //duration
  view.setUint32(20, 0x00010000); // rate = 1.0
  view.setUint32(24, 0x01000000); // volume = 1.0 + reserved(16)
  // 64 bits reserved
  // identity matrix:
  view.setUint32(36, 0x00010000);
  view.setUint32(42, 0x00010000);
  view.setUint32(68, 0x40000000);
  // predefined (32)[6]
  view.setUint32(96, 0xffffffff); // next track id

  return box('mvhd', buffer);
}

function moov(tracks: Track[]){
  return box('moov', mvhd(tracks), ...tracks.map((track, i) => trak(track, i+1)));
}

export function MP4File(tracks: Track[]){
  let offset = 36; // ftyp + mdat header
  for (const track of tracks) {
    track.byte_offset = offset;
    offset += track.data.byteLength;
  }

  return merge(ftyp(), mdat(tracks), moov(tracks));
}
