/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

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
		if(s_offset === last_offset){
			current.sample_count++;
		}else if(s_offset === 0){
			last_offset = 1/0;
		}else{
			last_offset = s_offset;
			current = {
				first_chunk: i + 1,
				sample_count: 1,
				sample_offset: s_offset
			};
			pd_diffs.push(current);
		}
	});
	return pd_diffs;
}

function mergeNALUs(nalus,length){
	'use strict';
	var arr = new Uint8Array(length),
		view = new DataView(arr.buffer),
		offset = 0;
	nalus.forEach(function(nalUnit){
		view.setUint32(offset, nalUnit.byteLength);
		arr.set(nalUnit, offset+4);
		offset += nalUnit.byteLength + 4;
	});
	return arr;
}

function video_data(packets){
	'use strict';
	var pps, sps, spsInfo, cropping, duration = 0, offset = 0,
		samples = [], nalus = [], sizes = [], dts_deltas = [];

	packets.forEach(function(packet){
		var size = 0, isIDR = false;

		parseNALStream(packet.data).forEach(function(nalUnit){
			switch(nalUnit[0] & 0x1F){
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
		});

		samples.push({
			offset: offset,
			pts: packet.pts,
			dts: packet.dts,
			isIDR: isIDR
		});

		sizes.push(size);
		dts_deltas.push(packet.frame_ticks);

		duration += packet.frame_ticks;
		offset += size;

	});

	spsInfo = parseSPS(sps);
	cropping = spsInfo.frame_cropping;

	return {
		type: 'v',
		pps: pps, sps: sps,
		spsInfo: spsInfo,
		width: (spsInfo.pic_width_in_mbs * 16)
				- (cropping.left + cropping.right) * 2,
		height: (2 - spsInfo.frame_mbs_only_flag) * (spsInfo.pic_height_in_map_units * 16)
				- (cropping.top + cropping.bottom) * 2,
		sizes: sizes,
		dts_diffs: mergeDeltas(dts_deltas),
		access_indices: samples.map(function(s,i){ return s.isIDR?i+1:-1; })
								.filter(function(i){ return i !== -1; }),
		pd_diffs: calcPDDiffs(samples),
		timescale: 90000,
		duration: duration / 90000,
		data: mergeNALUs(nalus, offset)
	};
}

var freqList = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];
function audio_data(audio_stream){
	'use strict';
	var duration = audio_stream.length,
		audioSize = audio_stream.byteLength,
		audioBuffer = new Uint8Array(audioSize),
		audioView = new DataView(audioBuffer.buffer),
		data_length, packet_length, header_length, 
		samplingFreqIndex, samplingFreq, word, sizes = [],
		maxAudioSize = 0, woffset = 0, roffset = 0, frames = 0;

	audio_stream.packets.forEach(function(packet){
		audioBuffer.set(packet.data, woffset);
		woffset += packet.data.byteLength;
	});

	for(woffset = 0; roffset < audioSize; frames++){
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

	word = audioView.getUint32(2);
	samplingFreqIndex = (word >> 26) & 0xf;
	samplingFreq = samplingFreq = freqList[samplingFreqIndex];

	return {
		type: 'a',
		profileMinusOne: (word >>> 30),
		channelConfig: (word >> 22) & 0x7,
		samplingFreqIndex: samplingFreq,
		maxAudioSize: maxAudioSize,
		maxBitrate: Math.round(maxAudioSize * frames / duration),
		avgBitrate: Math.round(audioSize / duration),
		sizes: sizes,
		dts_diffs: [{
			sample_count: frames,
			sample_delta: duration / frames
		}],
		timescale: samplingFreq,
		duration: duration,
		data: audioBuffer.subarray(0,woffset)
	};

}

addEventListener('message', function(event){
	var msg = event.data,
		streams = msg.streams,
		tracks = [];

	//if(streams[0xE0]){ tracks.push(video_data(streams[0xE0].packets)); }
	if(streams[0xC0]){ tracks.push(audio_data(streams[0xC0])); }

	postMessage({
		index: msg.index,
		url: URL.createObjectURL(MP4(tracks))
	});
});
