/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var MP4 = (function(){
	'use strict';

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

	var boxtypes = {};

	function toInt(s){
		return [].reduce.call(s, function(a, c){
			return (a << 8) | c.charCodeAt(0);
		}, 0);
	}

	function box(type, payload){
		var size = 8,
			header = new ArrayBuffer(8),
			view = new DataView(header),
			box = [header];

		if(!boxtypes.hasOwnProperty(type)){
			boxtypes[type] = toInt(type);
		}

		(payload instanceof Array?payload:[].slice.call(arguments, 1))
		.forEach(function(p){
			size += p.byteLength;
			if(p instanceof ArrayBuffer || p instanceof Uint8Array)
			{ box.push(p); }
			else{ box.push.apply(box, p.box); }
		}, 8);

		view.setUint32(0, size);
		view.setUint32(4, boxtypes[type]);

		return {byteLength: size, box: box};
	}

	function merge(){
		var i = 0, boxes = [].slice.call(arguments),
			size = boxes.reduce(function(a, n){ return a + n.byteLength; }, 0),
			arr = new Uint8Array(size);
		boxes.forEach(function(b){
			b.box.forEach(function(chunk){
				if(chunk instanceof ArrayBuffer){ chunk = new Uint8Array(chunk); }
				arr.set(chunk, i);
				i += chunk.byteLength;
			});
		});
		return arr;
	}

	function ftyp(){
		var buffer = new ArrayBuffer(20),
			view = new DataView(buffer);

		view.setUint32(0, 0x69736f6d); //major brand 'isom'
		view.setUint32(4, 1); //minor version
		view.setUint32(8, 0x69736f6d); //isom
		view.setUint32(12, 0x61766331); //avc1
		view.setUint32(16, 0x6d703431); //mp41

		return box('ftyp', buffer);
	}

	function mdat(tracks){
		var datas = tracks.map(function(track){ return track.data; });
		return box('mdat', datas);
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

	function hdlr(track){
		var buffer = new ArrayBuffer(37),
			view = new DataView(buffer);

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
		var buffer = new ArrayBuffer(12),
			view = new DataView(buffer);
		view.setUint32(0, 1); // version & flags
		// graphicsmode(16) & opcolor(16)[3]
		return box('vmhd', buffer);
	}

	function smhd(){
		// version & flags, balance & reserved, all zeroes
		return box('smhd', new ArrayBuffer(8));
	}

	function dref(){
		var buffer = new ArrayBuffer(21),
			view = new DataView(buffer);

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

	function avcC(track){
		var i, j,
			sps = track.sps,
			pps = track.pps,
			spslen = sps.byteLength,
			ppslen = pps.byteLength,
			spsInfo = track.spsInfo,
			buffer = new ArrayBuffer(spslen + ppslen + 11),
			view = new DataView(buffer);

		view.setUint8(0, 1); // version
		view.setUint8(1, spsInfo.profile_idc);
		view.setUint8(2, spsInfo.profile_compatibility);
		view.setUint8(3, spsInfo.level_idc);
		view.setUint8(4, 0xff); // 6 bits reserved + lengthSizeMinus1

		view.setUint8(5, 0xe1); // 3 bits reserved + SPS count
		view.setUint16(6, spslen);
		for(i = 0, j = 8; i < spslen; i++, j++){
			view.setUint8(j, sps[i]);
		}

		view.setUint8(8+spslen, 1); // PPS count
		view.setUint16(9+spslen, ppslen);
		for(i = 0, j = 11+spslen; i < ppslen; i++, j++){
			view.setUint8(j, pps[i]);
		}

		return box('avcC', buffer);
	}

	function avc1(track){
		var buffer = new ArrayBuffer(78),
			view = new DataView(buffer);

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

	function esds(track){
		var buffer = new ArrayBuffer(43),
			view = new DataView(buffer),
			freqIndex = track.samplingFreqIndex,
			objectType = track.profileMinusOne + 1,
			channelConf = track.channelConfig;

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

	function channelCount(conf){
		if(conf < 2){ return 1; } // 0 is AOT specific
		if(conf < 7){ return conf; }
		return 8;
	}

	var sampleRates = [
		96000, 88200, 64000, 48000, 44100, 32000,
		24000, 22050, 16000, 12000, 11025, 8000, 7350
	];

	function mp4a(track){
		var buffer = new ArrayBuffer(28),
			view = new DataView(buffer);

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

	function stsd(track){
		var buffer = new ArrayBuffer(8),
			view = new DataView(buffer);
		view.setUint32(4, 1); // entry count
		return box('stsd', buffer,
			track.type === 'video'?
			avc1(track):mp4a(track)
		);
	}

	function stts(track){
		var i, j, c,
			buffer, view,
			dts_diffs, current,
			last_delta = -1;

		// merge runs of identical deltas
		dts_diffs = [];
		track.samples.forEach(function(sample){
			var delta = sample.duration;
			if(delta !== last_delta){
				current = {sample_count: 1, sample_delta: delta};
				dts_diffs.push(current);
				last_delta = delta;
			}else{
				current.sample_count++;
			}
		});

		c = dts_diffs.length;
		buffer = new ArrayBuffer(c * 8 + 8),
		view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, c); // entry count

		for(i=0, j=8; i < c; i++, j+=8){
			view.setUint32(j, dts_diffs[i].sample_count);
			view.setUint32(j+4, dts_diffs[i].sample_delta);
		}

		return box('stts', buffer);
	}

	function stsz(track){
		var i, j,
			samples = track.samples,
			c = samples.length,
			buffer = new ArrayBuffer(c * 4 + 12),
			view = new DataView(buffer);

		//version & flags are zero
		//sample_size(32) = 0
		view.setUint32(8, c); // sample count

		for(i=0, j=12; i < c; i++, j+=4){
			view.setUint32(j, samples[i].size);
		}

		return box('stsz', buffer);
	}

	function stsc(track){
		var buffer = new ArrayBuffer(20),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, 1); // entry count
		view.setUint32(8, 1); // first chunk
		view.setUint32(12, track.samples.length); // sample count
		view.setUint32(16, 1); // sample description index

		return box('stsc', buffer);
	}

	function stco(track){
		var buffer = new ArrayBuffer(12),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, 1); // entry count
		view.setUint32(8, track.byte_offset);

		return box('stco', buffer);
	}

	function stss(track){
		var i, j,
			indices = track.samples
				.map(function(s,i){ return s.isIDR?i+1:-1; })
				.filter(function(i){ return i !== -1; }),
			c = indices.length,
			buffer = new ArrayBuffer(c * 4 + 8),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, c); // entry count

		for(i=0, j=8; i < c; i++, j+=4){
			view.setUint32(j, indices[i]);
		}

		return box('stss', buffer);
	}

	function ctts(track){
		var i, j, c,
			pd_diffs = [],
			last_offset = 1/0,
			current, buffer, view;

		// Merge runs of equal offsets into a single entry
		track.samples.forEach(function(s){
			var offset = s.cts;
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
		});

		c = pd_diffs.length;
		if(c === 0){ return new ArrayBuffer(0); }

		buffer = new ArrayBuffer(c * 8 + 8),
		view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, c); // entry count

		for(i=0, j=8; i < c; i++, j+=8){
			view.setUint32(j, pd_diffs[i].sample_count);
			view.setUint32(j+4, pd_diffs[i].sample_offset);
		}

		return box('ctts', buffer);
	}

	function stbl(track){
		var subboxes = [stsd, stts, stsc, stsz, stco];

		if(track.type === 'video'){
			subboxes.push(stss);
			subboxes.push(ctts);
		}

		return box('stbl', subboxes.map(function(b){ return b(track); }));
	}

	function minf(track){
		return box('minf',
			(track.type === 'video'?vmhd:smhd)(),
			dinf(), stbl(track)
		);
	}

	function mdhd(track){
		var buffer = new ArrayBuffer(24),
			view = new DataView(buffer);

		//version & flags = 0
		// creation & modification time = 0
		view.setUint32(12, 90000); // timescale
		view.setUint32(16, track.duration);
		view.setUint32(20, 0x55c40000); // 15-bit 'und' lang code & predefined = 0

		return box('mdhd', buffer);
	}

	function mdia(track){
		return box('mdia', mdhd(track), hdlr(track), minf(track));
	}

	function tkhd(track, id){
		var buffer = new ArrayBuffer(84),
			view = new DataView(buffer);

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

	function trak(track, id){
		return box('trak', tkhd(track, id), mdia(track));
	}

	function mvhd(tracks){
		var d, buffer = new ArrayBuffer(100),
			view = new DataView(buffer);

		d = Math.max.apply(Math,
			tracks.map(function(track){ return track.duration; })
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

	function moov(tracks){
		var subboxes,
			traks = tracks.map(function(track, i){
				return trak(track, i+1);
			});
		
		subboxes = [mvhd(tracks)].concat(traks);
		return box('moov', subboxes);
	}

	function MP4File(tracks){
		var offset = 36; // ftyp + mdat header

		tracks.forEach(function(track){
			track.byte_offset = offset;
			offset += track.data.byteLength;
		});

		return merge(ftyp(), mdat(tracks), moov(tracks));
	}

	return {
		File: MP4File
	};
})();
