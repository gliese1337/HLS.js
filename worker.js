importScripts('./lib/require.js');
importScripts('./TSDemuxer.js');
importScripts('./SPSParser.js');

require.config({
	paths: {
		jdataview: '//jdataview.github.io/dist/jdataview',
		jbinary: '//jdataview.github.io/dist/jbinary'
	}
});

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

function mergeDeltas(deltas, frame_rate){
	'use strict';
	var last_delta = -1,
		dts_diffs = [],
		current;

	deltas.forEach(function(delta){
		if(!delta){ delta = frame_rate; }
		if(delta !== last_delta){
			current = {sample_count: 1, sample_delta: delta};
			dts_diffs.push(current);
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
	var i, length, next, current, offset = 0,
		samples = [], nals = [], sizes = [],
		pps, sps, spsInfo, width, height,
		frame_rate, frame_sum = 0, frame_count = 0,
		dts_diffs, dts_delta, dts_deltas = [];

	video_stream.packets.forEach(function(packet){
		var curSample = {offset: offset, pts: packet.pts, dts: packet.dts};
		samples.push(curSample);

		parseNALStream(packet.data).forEach(function(nalUnit){
			var cropping;
			switch(nalUnit[0] & 0x1F){
				case 7:
					if(sps){ break; }
					sps = nalUnit;
					spsInfo = parseSPS(nalUnit);
					width = (spsInfo.pic_width_in_mbs_minus_1 + 1) * 16;
					height = (2 - spsInfo.frame_mbs_only_flag) * (spsInfo.pic_height_in_map_units_minus_1 + 1) * 16;

					if(spsInfo.frame_cropping_flag){
						cropping = spsInfo.frame_cropping;
						width -= 2 * (cropping.left + cropping.right);
						height -= 2 * (cropping.top + cropping.bottom);
					}
					break;
				case 8:
					if(pps){ break; }
					pps = nalUnit;
					break;
				case 5:
					curSample.isIDR = true;
				default: /* falls through */
					offset += nalUnit.length+4;
					nals.push(nalUnit);
			}
		});
	});

	// calculate byte & time sizes
	current = samples[0];
	for(i = 0, length = samples.length; i < length; i++){
		next = samples[i+1] || {offset: offset, dts: current.dts};
		sizes.push(next.offset - current.offset);
		dts_delta = next.dts - current.dts;
		dts_deltas.push(dts_delta);
		frame_sum += dts_delta;
		if(dts_delta){ frame_count++; }
		current = next;
	}

	frame_rate = Math.round(frame_sum / frame_count);
	dts_diffs = mergeDeltas(dts_deltas, frame_rate);

	return {
		pps: pps, sps: sps,
		spsInfo: spsInfo,
		width: width, height: height,
		sizes: sizes,
		dts_diffs: dts_diffs,
		accessIndices: samples.map(function(s,i){ return s.isIDR?i+1:-1; })
								.filter(function(i){ return i !== -1; }),
		pd_diffs: calcPDDiffs(samples),
		frame_rate: frame_rate,
		duration: dts_diffs.reduce(function(a,n){
			return a + n.sample_count*n.sample_delta;
		},0),
		data: mergeNALs(nals, offset)
	};
}

function audio_data(audio_stream){
	'use strict';
	var audioPackets = audio_stream.packets.map(function(p){ return p.data; }),
		audioBuffer = new Uint8Array(audio_stream.byteLength),
		audioView = new DataView(audioBuffer.buffer),
		audioSize = 0, audioSizes, maxAudioSize,
		profileMinusOne, samplingFreq, channelConfig,
		roffset, woffset, word,
		data_length, packet_length, header_length,
		freqs = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350];

	audioPackets.forEach(function(packet){
		audioBuffer.set(packet, audioSize);
		audioSize += packet.length;
	});

	word = audioView.getUint32(2);
	header_length = (audioView.getUint8(1)|1) ? 7 : 9;
	packet_length = (word>>5)&0x1fff;
	profileMinusOne = (word >>> 30);
	samplingFreq = freqs[(word >> 26) & 0xf];
	channelConfig = (word >> 22) & 0x7;

	data_length = packet_length - header_length;
	audioBuffer.set(audioBuffer.subarray(header_length, packet_length));
	roffset = packet_length;
	woffset = data_length;
	maxAudioSize = data_length;
	audioSizes = [data_length];

	while(roffset < audioSize){
		header_length = (audioView.getUint8(roffset+1)&1) ? 7 : 9;
		packet_length = (audioView.getUint32(roffset+2)>>5)&0x1fff;
		data_length = packet_length - header_length;
		audioBuffer.set(audioBuffer.subarray(roffset+header_length, roffset+packet_length), woffset);
		roffset += packet_length;
		woffset += data_length;
		audioSizes.push(data_length);
		if(maxAudioSize < data_length){
			maxAudioSize = data_length;
		}
	}

	return {
		profileMinusOne: profileMinusOne,
		channelConfig: channelConfig,
		samplingFreq: samplingFreq,
		audioSize: audioSize,
		maxAudioSize: maxAudioSize,
		audioSizes: audioSizes,
		data: audioBuffer.subarray(0,woffset)
	};

}

require(['jbinary', './mp4'],
	function(jBinary, MP4){
		'use strict';

		function mpegts_to_mp4(streams){
			var mp4, trak,
				creationTime = new Date(),
				audio_pes = streams.filter(function(s){ return s.content_type === 1; })[0],
				video_pes = streams.filter(function(s){ return s.content_type === 2; })[0],
				vdata = video_data(video_pes),
				adata = audio_data(audio_pes),
				audioStart = vdata.data.byteLength,
				mdat = new Uint8Array(vdata.data.byteLength + adata.data.byteLength);

			mdat.set(vdata.data);
			mdat.set(adata.data,audioStart);

			// generating resulting MP4

			mp4 = new jBinary(mdat.byteLength*2, MP4);
			
			trak = [{
				atoms: {
					tkhd: [{
						version: 0,
						flags: 15,
						track_ID: 1,
						duration: vdata.duration,
						layer: 0,
						alternate_group: 0,
						volume: 1,
						matrix: {
							a: 1, b: 0, x: 0,
							c: 0, d: 1, y: 0,
							u: 0, v: 0, w: 1
						},
						dimensions: {
							horz: vdata.width,
							vert: vdata.height
						}
					}],
					mdia: [{
						atoms: {
							mdhd: [{
								version: 0,
								flags: 0,
								timescale: 90000,
								duration: vdata.duration,
								lang: 'und'
							}],
							hdlr: [{
								version: 0,
								flags: 0,
								handler_type: 'vide',
								name: 'VideoHandler'
							}],
							minf: [{
								atoms: {
									vmhd: [{
										version: 0,
										flags: 1,
										graphicsmode: 0,
										opcolor: {r: 0, g: 0, b: 0}
									}],
									dinf: [{
										atoms: {
											dref: [{
												version: 0,
												flags: 0,
												entries: [{
													type: 'url ',
													version: 0,
													flags: 1,
													location: ''
												}]
											}]
										}
									}],
									stbl: [{
										atoms: {
											stsd: [{
												version: 0,
												flags: 0,
												entries: [{
													type: 'avc1',
													data_reference_index: 1,
													dimensions: {
														horz: vdata.width,
														vert: vdata.height
													},
													resolution: {
														horz: 72,
														vert: 72
													},
													frame_count: 1,
													compressorname: '',
													depth: 24,
													atoms: {
														avcC: [{
															version: 1,
															profileIndication: vdata.spsInfo.profile_idc,
															profileCompatibility: vdata.spsInfo.profile_compatibility,
															levelIndication: vdata.spsInfo.level_idc,
															lengthSizeMinusOne: 3,
															seqParamSets: [vdata.sps],
															pictParamSets: [vdata.pps]
														}]
													}
												}]
											}],
											stts: [{
												version: 0,
												flags: 0,
												entries: vdata.dts_diffs
											}],
											stss: [{
												version: 0,
												flags: 0,
												entries: vdata.accessIndices
											}],
											ctts: [{
												version: 0,
												flags: 0,
												entries: vdata.pd_diffs
											}],
											stsc: [{
												version: 0,
												flags: 0,
												entries: [{
													first_chunk: 1,
													samples_per_chunk: vdata.sizes.length,
													sample_description_index: 1
												}]
											}],
											stsz: [{
												version: 0,
												flags: 0,
												sample_size: 0,
												sample_count: vdata.sizes.length,
												sample_sizes: vdata.sizes
											}],
											stco: [{
												version: 0,
												flags: 0,
												entries: [0x28]
											}]
										}
									}]
								}
							}]
						}
					}]
				}
			}];

			if(adata.audioSize > 0){
				trak.push({
					atoms: {
						tkhd: [{
							version: 0,
							flags: 15,
							track_ID: 2,
							duration: vdata.duration,
							layer: 0,
							alternate_group: 1,
							volume: 1,
							matrix: {
								a: 1, b: 0, x: 0,
								c: 0, d: 1, y: 0,
								u: 0, v: 0, w: 1
							},
							dimensions: {
								horz: 0,
								vert: 0
							}
						}],
						mdia: [{
							atoms: {
								mdhd: [{
									version: 0,
									flags: 0,
									timescale: 90000,
									duration: vdata.duration,
									lang: 'eng'
								}],
								hdlr: [{
									version: 0,
									flags: 0,
									handler_type: 'soun',
									name: 'SoundHandler'
								}],
								minf: [{
									atoms: {
										smhd: [{
											version: 0,
											flags: 0,
											balance: 0
										}],
										dinf: [{
											atoms: {
												dref: [{
													version: 0,
													flags: 0,
													entries: [{
														type: 'url ',
														version: 0,
														flags: 1,
														location: ''
													}]
												}]
											}
										}],
										stbl: [{
											atoms: {
												stsd: [{
													version: 0,
													flags: 0,
													entries: [{
														type: 'mp4a',
														data_reference_index: 1,
														channelcount: 2,
														samplesize: 16,
														samplerate: 22050,
														atoms: {
															esds: [{
																version: 0,
																flags: 0,
																sections: [
																	{
																		descriptor_type: 3,
																		ext_type: 128,
																		length: 34,
																		es_id: 2,
																		stream_priority: 0
																	},
																	{
																		descriptor_type: 4,
																		ext_type: 128,
																		length: 20,
																		type: 'mpeg4_audio',
																		stream_type: 'audio',
																		upstream_flag: 0,
																		buffer_size: 0,
																		maxBitrate: Math.round(adata.maxAudioSize / (vdata.duration / 90000 / adata.audioSizes.length)),
																		avgBitrate: Math.round((adata.data.byteLength) / (vdata.duration / 90000))
																	},
																	{
																		descriptor_type: 5,
																		ext_type: 128,
																		length: 2,
																		audio_profile: adata.profileMinusOne + 1,
																		sampling_freq: adata.samplingFreq,
																		channelConfig: adata.channelConfig
																	},
																	{
																		descriptor_type: 6,
																		ext_type: 128,
																		length: 1,
																		sl: 2
																	}
																]
															}]
														}
													}]
												}],
												stts: [{
													version: 0,
													flags: 0,
													entries: [{
														sample_count: adata.audioSizes.length,
														sample_delta: Math.round(vdata.duration / adata.audioSizes.length)
													}]
												}],
												stsc: [{
													version: 0,
													flags: 0,
													entries: [{
														first_chunk: 1,
														samples_per_chunk: adata.audioSizes.length,
														sample_description_index: 1
													}]
												}],
												stsz: [{
													version: 0,
													flags: 0,
													sample_size: 0,
													sample_count: adata.audioSizes.length,
													sample_sizes: adata.audioSizes
												}],
												stco: [{
													version: 0,
													flags: 0,
													entries: [0x28 + audioStart]
												}]
											}
										}]
									}
								}]
							}
						}]
					}
				});
			}

			mp4.write('File', {
				ftyp: [{
					major_brand: 'isom',
					minor_version: 512,
					compatible_brands: ['isom', 'iso2', 'avc1', 'mp41']
				}],
				mdat: [{
					_rawData: mdat
				}],
				moov: [{
					atoms: {
						mvhd: [{
							version: 0,
							flags: 0,
							creation_time: creationTime,
							modification_time: creationTime,
							timescale: 90000,
							duration: vdata.duration,
							rate: 1,
							volume: 1,
							matrix: {
								a: 1, b: 0, x: 0,
								c: 0, d: 1, y: 0,
								u: 0, v: 0, w: 1
							},
							next_track_ID: 2
						}],
						trak: trak
					}
				}]
			});
			
			return mp4.slice(0, mp4.tell());
		}
		
		addEventListener('message', function(event){
			var mp4, msg = event.data,
				dm = new TSDemuxer();
			dm.process(msg.buffer);
			console.time('convert');
			mp4 = mpegts_to_mp4(dm.streams);
			console.timeEnd('convert');
			
			postMessage({
				type: 'video',
				index: msg.index,
				original: msg.url,
				url: mp4.toURI('video/mp4')
			});
		});

		postMessage({type: 'ready'});
	}
);