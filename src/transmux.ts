import { video_data } from './videoData';
import { audio_data } from './audioData';
import { TSDemuxer, ErrCodes, StreamData, programs2streams } from './TSDemuxer';
import { MP4File, Track } from './MP4Muxer';

export function transmux(data: Uint8Array): Uint8Array {
  const demuxer = new TSDemuxer();
  for (let i = 0; i < data.byteLength; i += 500) {
    const err = demuxer.process(data.subarray(i, i + 500));//, i, Math.min(500, data.byteLength - i));
    if (err > 1) throw new Error(`${ err }, ${ ErrCodes[err] }`);
  }
  
  //const err = demuxer.process(data);
  //if (err > 1) throw new Error(ErrCodes[err]);
  const streams = programs2streams(demuxer.pids);
	const tracks: Track[] = [];

	if (streams.has(0xE0)) { tracks.push(video_data(streams.get(0xE0) as StreamData)); }
	if (streams.has(0xC0)) { tracks.push(audio_data(streams.get(0xC0) as StreamData)); }

	return MP4File(tracks);
}
