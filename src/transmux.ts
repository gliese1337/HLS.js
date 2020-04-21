import { video_data } from './videoData';
import { audio_data } from './audioData';
import { TSDemuxer, ErrCodes, StreamData } from './TSDemuxer';
import { MP4File, Track } from './MP4Muxer';

export function transmux(data: Uint8Array) {
  const demuxer = new TSDemuxer();
  const [err, streams] = demuxer.process(data);
  if (err > 0 || !streams) throw new Error(ErrCodes[err]);
  
	const tracks: Track[] = [];

	if(streams.has(0xE0)){ tracks.push(video_data(streams.get(0xE0) as StreamData)); }
	if(streams.has(0xC0)){ tracks.push(audio_data(streams.get(0xC0) as StreamData)); }

	return MP4File(tracks);
}
