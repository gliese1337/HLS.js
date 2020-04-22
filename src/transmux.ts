import { VideoStream } from './videoData';
import { audio_data } from './audioData';
import { TSDemuxer, ErrCodes } from './TSDemuxer';
import { MP4File, Track } from './MP4Muxer';
import { StreamData } from './streamData';

export function transmux(data: Uint8Array): Uint8Array {
  const videoStream = new VideoStream();
  const audioStream = new StreamData();
  const demuxer = new TSDemuxer((packet) => {
    switch (packet.stream_id) {
      case 0xE0: videoStream.process(packet); break;
      case 0xC0: audioStream.add(packet); break;
    }
  });

  for (let i = 0; i < data.byteLength; i += 500) {
    const err = demuxer.process(data.subarray(i, i + 500));//, i, Math.min(500, data.byteLength - i));
    if (err > 1) throw new Error(`${ err }, ${ ErrCodes[err] }`);
  }
  
  //const err = demuxer.process(data);
  //if (err > 1) throw new Error(ErrCodes[err]);
  demuxer.finalize();
	const tracks: Track[] = [];

	if (videoStream.byteLength > 0) { tracks.push(videoStream.getTrack()); }
	if (audioStream.byteLength > 0) { tracks.push(audio_data(audioStream)); }

	return MP4File(tracks);
}
