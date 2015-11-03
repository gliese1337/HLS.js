/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var MP4 = (function(){
	'use strict';

	var arraytypes = [ArrayBuffer, Uint32Array, Uint8Array];
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

		(payload instanceof Array?payload:[payload])
		.forEach(function(p){
			size += p.byteLength;
			if(arraytypes.some(function(t){ return p instanceof t; }))
			{ box.push(p); }
			else{ box.push.apply(box, p.box); }
		}, 8);

		view.setUint32(0, size);
		view.setUint32(4, boxtypes[type]);

		return {byteLength: size, box: box};
	}

	function ftyp(){
		var buffer = new ArrayBuffer(24),
			view = new DataView(buffer);

		view.setUint32(0, 0x69736f6d); //major brand 'isom'
		view.setUint32(4, 512); //minor version
		view.setUint32(8, 0x69736f6d); //isom
		view.setUint32(12, 0x69736f32); //iso2
		view.setUint32(16, 0x61766331); //avc1
		view.setUint32(20, 0x6d703431); //mp41

		return box('ftyp', buffer);
	}

	function mdat(tracks){
		var datas = tracks.map(function(track){ return track.data; });
		return box('mdat', datas);
	}

	function hdlr(trkdata){
		var buffer = new ArrayBuffer(37),
			view = new DataView(buffer);

		if(trkdata.type==='video'){
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
		//Can't just use new Uint32Array([...]) because endianness is not guaranteed
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

	function stts(trkdata){
		var i, j,
			dts_diffs = trkdata.dts_diffs,
			c = dts_diffs.length,
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

	function ctts(trkdata){
		var i, j,
			pd_diffs = trkdata.pd_diffs,
			c = pd_diffs.length,
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

	function stss(trkdata){
		var i, j,
			indices = trkdata.access_indices,
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

	function stsz(trkdata){
		var i, j,
			sizes = trkdata.sizes,
			c = sizes.length,
			buffer = new ArrayBuffer(c * 4 + 12),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(8, c); // sample count

		for(i=0, j=12; i < c; i++, j+=4){
			view.setUint32(j, sizes[i]);
		}

		return box('stsz', buffer);
	}

	function stsc(trkdata){
		var buffer = new ArrayBuffer(20),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, 1);
		view.setUint32(8, 1);
		view.setUint32(12, trkdata.sizes.length); // sample count
		view.setUint32(16, 1);

		return box('stsc', buffer);
	}

	function stco(trkdata){
		var buffer = new ArrayBuffer(12),
			view = new DataView(buffer);

		//version & flags are zero
		view.setUint32(4, 1);
		view.setUint32(8, trkdata.byte_offset);

		return box('stco', buffer);
	}

	function avcC(trkdata){
		var i, j,
			sps = trkdata.sps,
			pps = trkdata.pps,
			spslen = sps.byteLength,
			ppslen = pps.byteLength,
			spsInfo = trkdata.spsInfo,
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

	function avc1(trkdata){
		var buffer = new ArrayBuffer(78),
			view = new DataView(buffer);

		// six bytes reserved
		view.setUint16(6, 1); // data reference index
		// VisualSampleEntry data
		// 4 words / 16 bytes predefined & reserved space, all zeroes
		view.setUint16(24, trkdata.width); // width
		view.setUint16(26, trkdata.height); // height
		view.setUint32(28, 0x00480000); // 72dpi horiz res.
		view.setUint32(32, 0x00480000); // 72dpi vert res.
		// 4 bytes reserved
		view.setUint16(40, 1); // frame count
		// 32 bytes / 8 words of empty compressor name string
		view.setUint16(74, 24); // bit depth
		view.setUint16(76, 0xffff); // predefined

		return box('avc1', [buffer, avcC(trkdata)]);
	}

	function esds(trkdata){
		var buffer = new ArrayBuffer(43),
			view = new DataView(buffer),
			freqIndex = trkdata.samplingFreqIndex,
			objectType = trkdata.profileMinusOne + 1,
			channelConf = trkdata.channelConfig;

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
		view.setUint32(22, trkdata.maxBitrate);
		view.setUint32(26, trkdata.avgBitrate);

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

	function mp4a(trkdata){
		var buffer = new ArrayBuffer(28),
			view = new DataView(buffer);

		// 6 bytes reserved
		view.setUint16(6, 1); // data reference index
		// AudioSampleEntry data
		// 8 bytes reserved
		view.setUint16(16, channelCount(trkdata.channelConfig));
		view.setUint16(18, 16); // sample size
		// 4 bytes reserved
		view.setUint32(24, sampleRates[trkdata.samplingFreqIndex]<<16);

		// mp4a extends AudioSampleEntry with ESDBox
		return box('mp4a', [buffer, esds(trkdata)]);
	}

	function stsd(trkdata){
		var buffer = new ArrayBuffer(8),
			view = new DataView(buffer);
		view.setUint32(4, 1); // entry count
		return box('stsd', [
			buffer,
			trkdata.type === 'video'?
			avc1(trkdata):mp4a(trkdata)
		]);
	}

	function stbl(trkdata){
		var subboxes = [stsd, stts, stsc, stsz, stco];

		if(trkdata.type === 'video'){
			subboxes.push(stss);
			if(trkdata.pd_diffs.length){
				subboxes.push(ctts);
			}
		}

		return box('stbl', subboxes.map(function(b){ return b(trkdata); }));
	}

	function minf(trkdata){
		return box('minf', [
			(trkdata.type === 'video'?vmhd:smhd)(),
			dinf(), stbl(trkdata)
		]);
	}

	function mdhd(trkdata){
		var buffer = new ArrayBuffer(24),
			view = new DataView(buffer);

		//version & flags = 0
		// creation & modification time = 0
		view.setUint32(12, 90000); // timescale
		view.setUint32(16, trkdata.duration);
		view.setUint32(20, 0x55c40000); // 15-bit 'und' lang code & predefined = 0

		return box('mdhd', buffer);
	}

	function mdia(trkdata){
		return box('mdia', [mdhd(trkdata), hdlr(trkdata), minf(trkdata)]);
	}

	function tkhd(trkdata, id){
		var buffer = new ArrayBuffer(80),
			view = new DataView(buffer);

		view.setUint32(0, 15); // version & flags
		// creation & modification time = 0
		view.setUint32(12, id);
		view.setUint32(20, trkdata.duration || 0xffffffff);
		// reserved, layer(16) & alternate group(16)
		// set volume at byte 32 later
		// identity matrix:
		view.setUint32(36, 0x01000000);
		view.setUint32(52, 0x00010000);
		view.setUint32(68, 0x40000000);

		if(trkdata.type === 'audio'){
			view.setUint32(32, 0x01000000); // volume & reserved bits
		}else{
			view.setUint32(72, (trkdata.width & 0xffff)<<16);  // 16.16 width, ignoring fractional part
			view.setUint32(76, (trkdata.height & 0xffff)<<16); // 16.16 height, ignoring fractional part
		}

		return box('tkhd', buffer);
	}

	function trak(trkdata, id){
		return box('trak', [tkhd(trkdata), mdia(trkdata)]);
	}

	function mvhd(tracks){
		var d, buffer = new ArrayBuffer(100),
			view = new DataView(buffer);

		d = Math.max.apply(Math,
			tracks.map(function(trkdata){ return trkdata.duration; })
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
		var subboxes = [mvhd(tracks)].concat(
			tracks.map(function(trkdata, i){
				return trak(trkdata, i+1);
			})
		);

		return box('moov', subboxes);
	}

	function MP4File(tracks){
		var offset = 40; // ftyp + mdat header

		tracks.forEach(function(track){
			track.byte_offset = offset;
			offset += track.data.byteLength;
		});

		return new Blob(
			ftyp().box
			.concat(mdat(tracks).box)
			.concat(moov(tracks).box),
			{type: 'video/mp4'}
		);
	}

	return {
		File: MP4File
	};
})();
