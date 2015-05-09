importScripts('./TSDemuxer.js');
importScripts('./SPSParser.js');
importScripts('./MP4Muxer.js');

function parseNALStream(bytes){
	'use strict';
	var view = new DataView(bytes.buffer,bytes.byteOffset),
		len = bytes.byteLength - 3,
		start, end = 1, nalUnits = [];

	do {
		end += view.getUint16(end+1)?3:4;
		start = end;
		for(start = end; end < len; end++){
			if(view.getUint16(end) === 0 &&
				(bytes[end+2] === 1 || (view.getUint16(end+2) === 1))){
				nalUnits.push(bytes.subarray(start, end));
				break;
			}
		}
	}while(end < len);
	nalUnits.push(bytes.subarray(start));
	return nalUnits;
}

function mergeDeltas(deltas){
	'use strict';
	var last_delta = -1,
		dts_diffs = [],
		current;

	deltas.forEach(function(delta){
		if(delta !== last_delta){
			current = {sample_count: 1, sample_delta: delta};
			dts_diffs.push(current);
			last_delta = delta;
		}else{
			current.sample_count++;
		}
	});
	return dts_diffs;
}

function calcPDDiffs(samples){
	'use strict';
	var current,
		last_offset = 1/0,
		pd_diffs = [];

	samples.forEach(function(s, i){
		var s_offset = s.pts - s.dts;
		if(s_offset !== last_offset){
			if(s_offset === 0){
				last_offset = 1/0;
				return;
			}
			last_offset = s_offset;
			current = {
				first_chunk: i + 1,
				sample_count: 1,
				sample_offset: s_offset
			};
			pd_diffs.push(current);
		}else{
			current.sample_count++;
		}
	});
	return pd_diffs;
}

function mergeNALs(nals,length){
	'use strict';
	var arr = new Uint8Array(length),
		view = new DataView(arr.buffer),
		offset = 0;
	nals.forEach(function(nalUnit){
		view.setUint32(offset, nalUnit.byteLength);
		arr.set(nalUnit, offset+4);
		offset += nalUnit.byteLength + 4;
	});
	return arr;
}

function video_data(video_stream){
	'use strict';
	var i, len, next, current, offset = 0,
		samples = [], nals = [], sizes = [],
		pps, sps, spsInfo, width, height,
		dts_deltas = [];

	video_stream.packets.forEach(function(packet){
		var size = 0,
			curSample = {
				offset: offset,
				pts: packet.pts,
				dts: packet.dts
			};

		parseNALStream(packet.data).forEach(function(nalUnit){
			var cropping;
			switch(nalUnit[0] & 0x1F){
				case 7:
					if(sps){ break; }
					sps = nalUnit;
					spsInfo = parseSPS(nalUnit);

					//Height & Width data are junk; might be a problem with SPS parser,
					//but everything seems to work fine without them anyway
					/*cropping = spsInfo.frame_cropping;
					width = (spsInfo.pic_width_in_mbs * 16)
								- (cropping.left + cropping.right) * 2;
					height = (2 - spsInfo.frame_mbs_only_flag) * (spsInfo.pic_height_in_map_units * 16)
								- (cropping.top + cropping.bottom) * 2;
					*/
					break;
				case 8:
					if(pps){ break; }
					pps = nalUnit;
					break;
				case 5:
					curSample.isIDR = true;
				default: /* falls through */
					size += nalUnit.length+4;
					nals.push(nalUnit);
			}
		});

		offset += size;
		sizes.push(size);
		samples.push(curSample);
		dts_deltas.push(packet.frame_ticks);

	});

	return {
		type: 'v',
		pps: pps, sps: sps,
		spsInfo: spsInfo,
		width: 0, height:0, //width, height: height,
		sizes: sizes,
		dts_diffs: mergeDeltas(dts_deltas),
		access_indices: samples.map(function(s,i){ return s.isIDR?i+1:-1; })
								.filter(function(i){ return i !== -1; }),
		pd_diffs: calcPDDiffs(samples),
		timescale: 90000,
		duration: video_stream.length,
		data: mergeNALs(nals, offset)
	};
}

var freqList = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function audio_data(audio_stream){
	'use strict';
	var duration = audio_stream.length,
		audioPackets = audio_stream.packets.map(function(p){ return p.data; }),
		audioBuffer = new Uint8Array(audio_stream.byteLength),
		audioView = new DataView(audioBuffer.buffer),
		audioSize = 0, maxAudioSize, profileMinusOne,
		samplingFreq, samplingFreqIndex, channelConfig,
		data_length, packet_length, header_length, sizes,
		woffset, roffset, word, frames;

	audioPackets.forEach(function(packet){
		audioBuffer.set(packet, audioSize);
		audioSize += packet.length;
	});

	word = audioView.getUint32(2);
	header_length = (audioView.getUint8(1)|1) ? 7 : 9;
	packet_length = (word>>5)&0x1fff;
	profileMinusOne = (word >>> 30);
	samplingFreqIndex = (word >> 26) & 0xf;
	samplingFreq = freqList[samplingFreqIndex];
	channelConfig = (word >> 22) & 0x7;

	data_length = packet_length - header_length;
	audioBuffer.set(audioBuffer.subarray(header_length, packet_length));
	roffset = packet_length;
	woffset = data_length;
	maxAudioSize = data_length;
	sizes = [data_length];

	for(frames = 0; roffset < audioSize; frames++){
		header_length = (audioView.getUint8(roffset+1)&1) ? 7 : 9;
		packet_length = (audioView.getUint32(roffset+2)>>5)&0x1fff;
		data_length = packet_length - header_length;
		audioBuffer.set(audioBuffer.subarray(roffset+header_length, roffset+packet_length), woffset);
		roffset += packet_length;
		woffset += data_length;
		sizes.push(data_length);
		if(maxAudioSize < data_length){
			maxAudioSize = data_length;
		}
	}

	return {
		type: 'a',
		profileMinusOne: profileMinusOne,
		channelConfig: channelConfig,
		samplingFreqIndex: samplingFreqIndex,
		maxAudioSize: maxAudioSize,
		maxBitrate: Math.round(maxAudioSize * frames / duration),
		avgBitrate: Math.round(audioSize / duration),
		sizes: sizes,
		dts_diffs: [{
			sample_count: frames,
			sample_delta: Math.round(duration * samplingFreq / frames)
		}],
		timescale: samplingFreq,
		duration: duration,
		data: audioBuffer.subarray(0,audioSize)
	};
}

addEventListener('message', function(event){
	var streams, tracks = [],
		msg = event.data;

	streams = (new TSDemuxer()).process(msg.buffer);
	if(streams[0xE0]){ tracks.push(video_data(streams[0xE0])); }
	if(streams[0xC0]){ tracks.push(audio_data(streams[0xC0])); }

	postMessage({
		index: msg.index,
		url: URL.createObjectURL(MP4(tracks))
	});
});
