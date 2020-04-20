import { video_data } from './videoData';
import { audio_data } from './audioData';
import { MP4File } from './MP4Muxer';

addEventListener('message', function(event){
	const msg = event.data;
	const streams = msg.streams;
	const tracks = [];

	if(streams[0xE0]){ tracks.push(video_data(streams[0xE0])); }
	if(streams[0xC0]){ tracks.push(audio_data(streams[0xC0])); }

	const file = MP4File(tracks);
	postMessage({
		index: msg.index,
		file: file.buffer
	},[file.buffer]);
});
