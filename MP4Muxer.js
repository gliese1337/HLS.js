function add_atom(atom, sub_atom){
	'use strict';
	atom.size += sub_atom.size;
	atom.box.push.apply(atom.box, sub_atom.box);
}

function ftyp(){
	'use strict';
	var buffer = new ArrayBuffer(32),
		view = new DataView(buffer);

	view.setUint32(0, 32); // box size
	view.setUint32(4, 0x66747970); // 'ftyp'
	view.setUint32(8, 0x69736f6d); //major brand 'isom'
	view.setUint32(12, 512); //minor version
	view.setUint32(16, 0x69736f6d); //isom
	view.setUint32(20, 0x69736f32); //iso2
	view.setUint32(24, 0x61766331); //avc1
	view.setUint32(28, 0x6d703431); //mp41

	return {size: 32, box: [buffer]};
}

function mdat(tracks){
	'use strict';
	var datas = tracks.map(function(track){ return track.data.buffer; }),
		length = datas.reduce(function(p,n){ return p + n.byteLength; },8),
		buffer = new ArrayBuffer(8),
		view = new DataView(buffer);

	view.setUint32(0, length);
	view.setUint32(4, 0x6d646174); // mdat
	return {size: length, box: [buffer].concat(datas)};
}

function hdlr(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(20),
		view = new DataView(buffer);

	view.setUint32(0, 20);
	view.setUint32(4, 0x68646c72); // hdlr
	trkdata.type==='v'?
		view.setUint32(16, 0x76696465): // vide
		view.setUint32(16, 0x736f756e); // soun

	return {size: 20, box: [buffer]};
}

function vmhd(){
	'use strict';
	var buffer = new ArrayBuffer(12),
		view = new DataView(buffer);

	view.setUint32(0, 12);
	view.setUint32(4, 0x766d6864); // vmhd
	view.setUint32(8, 1); // version & flags
	// graphicsmode(16) & opcolor(16)[3]

	return {size: 12, box: [buffer]};
}

function smhd(){
	'use strict';
	var buffer = new ArrayBuffer(8),
		view = new DataView(buffer);

	view.setUint32(0, 8);
	view.setUint32(4, 0x736d6864); // smhd
	// version & flags, balance & reserved

	return {size: 8, box: [buffer]};
}

function dinf(){
	'use strict';
	var buffer = new ArrayBuffer(36),
		view = new DataView(buffer);

	view.setUint32(0, 36);
	view.setUint32(4, 0x64696e66); // dinf
	// Data Reference sub-box
	view.setUint32(8, 28);
	view.setUint32(12, 0x64726566); // dref
	// flags
	view.setUint32(20, 1); // entry count
	//DataEntryUrl sub-box
	view.setUint32(24, 12);
	view.setUint32(28, 0x75726c20); // 'url '
	view.setUint32(32, 1); // self-contained flag
	//no url string in self-contained version

	return {size: 36, box: [buffer]};
}

function stts(dts_diffs){
	'use strict';
	var i, j,
		c = dts_diffs.length,
		l = c * 8 + 16,
		buffer = new ArrayBuffer(l),
		view = new DataView(buffer);

	view.setUint32(0, l); // size
	view.setUint32(4, 0x73747473); // stts
	//version & flags are zero
	view.setUint32(12, c); // entry count

	for(i=0, j=16; i < c; i++, j+=8){
		view.setUint32(j, dts_diffs[i].sample_count);
		view.setUint32(j+4, dts_diffs[i].sample_delta);
	}

	return {size: l, box: [buffer]};
}

function ctts(pd_diffs){
	'use strict';
	var i, j,
		c = pd_diffs.length,
		l = c * 8 + 16,
		buffer = new ArrayBuffer(l),
		view = new DataView(buffer);

	view.setUint32(0, l); // size
	view.setUint32(4, 0x63747473); // ctts
	//version & flags are zero
	view.setUint32(12, c); // entry count

	for(i=0, j=16; i < c; i++, j+=8){
		view.setUint32(j, pd_diffs[i].sample_count);
		view.setUint32(j+4, pd_diffs[i].sample_offset);
	}
	return {size: l, box: [buffer]};
}

function stss(indices){
	'use strict';
	var i, j, c = indices.length,
		l = c * 4 + 16,
		buffer = new ArrayBuffer(l),
		view = new DataView(buffer);

	view.setUint32(0, l); // size
	view.setUint32(4, 0x73747373); // stss
	//version & flags are zero
	view.setUint32(12, c); // entry count

	for(i=0, j=16; i < c; i++, j+=4){
		view.setUint32(j, indices[i]);
	}
	return {size: l, box: [buffer]};
}

function stsz(sizes){
	'use strict';
	var i, j, c = sizes.length,
		l = c * 4 + 20,
		buffer = new ArrayBuffer(l),
		view = new DataView(buffer);

	view.setUint32(0, l); // size
	view.setUint32(4, 0x7374737a); // stsz
	//version & flags are zero
	view.setUint32(16, c); // sample count

	for(i=0, j=20; i < c; i++, j+=4){
		view.setUint32(j, sizes[i]);
	}
	return {size: l, box: [buffer]};
}

function stsc(samples){
	'use strict';
	var buffer = new ArrayBuffer(28),
		view = new DataView(buffer);

	view.setUint32(0, 28);
	view.setUint32(4, 0x73747363); // stsc
	view.setUint32(12, 1);
	view.setUint32(16, 1);
	view.setUint32(20, samples);
	view.setUint32(24, 1);

	return {size: 28, box: [buffer]};
}

function stco(offset){
	'use strict';
	var buffer = new ArrayBuffer(20),
		view = new DataView(buffer);

	view.setUint32(0, 20);
	view.setUint32(4, 0x7374636f); // stco
	view.setUint32(12, 1);
	view.setUint32(16, offset);

	return {size: 20, box: [buffer]};
}

function avcC(trkdata){
	'use strict';
	var i, j,
		sps = trkdata.sps,
		pps = trkdata.pps,
		spslen = sps.byteLength,
		ppslen = pps.byteLength,
		len = spslen + ppslen + 19,
		spsInfo = trkdata.spsInfo,
		buffer = new ArrayBuffer(len),
		view = new DataView(buffer);

	view.setUint32(0, len);
	view.setUint32(4, 0x61766343); // avcC
	view.setUint8(8, 1); // version
	view.setUint8(9, spsInfo.profile_idc);
	view.setUint8(10, spsInfo.profile_compatibility);
	view.setUint8(11, spsInfo.level_idc);
	view.setUint8(12, 0xff); // 6 bits reserved + lengthSizeMinus1

	view.setUint8(13, 0xe1); // 3 bits reserved + SPS count
	view.setUint16(14, spslen);
	for(i = 0, j = 16; i < spslen; i++, j++){
		view.setUint8(j, sps[i]);
	}

	view.setUint8(16+spslen, 1); // PPS count
	view.setUint16(17+spslen, ppslen);
	for(i = 0, j = 19+spslen; i < ppslen; i++, j++){
		view.setUint8(j, pps[i]);
	}

	return {size: len, box: [buffer]};
}

function avc1(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(86),
		view = new DataView(buffer),
		atom = {size: 86, box: [buffer]};

	view.setUint32(4, 0x61766331); // avc1
	// six bytes reserved
	view.setUint16(14, 1); // data reference index
	// VisualSampleEntry data
	// 4 words / 16 bytes predefined & reserved space, all zeroes
	view.setUint16(32, trkdata.width); // width
	view.setUint16(34, trkdata.height); // height
	view.setUint32(36, 0x00480000); // 72dpi horiz res.
	view.setUint32(40, 0x00480000); // 72dpi vert res.
	// 4 bytes reserved
	view.setUint16(48, 1); // frame count
	// 32 bytes / 8 words of empty compressor name string
	view.setUint16(82, 24); // bit depth
	view.setInt16(84, -1); // predefined

	add_atom(atom, avcC(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function esds(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(39),
		view = new DataView(buffer),
		freqIndex = trkdata.samplingFreqIndex,
		objectType = trkdata.profileMinusOne + 1,
		channelConf = trkdata.channelConfig;

	view.setUint32(0, 39); // esds
	view.setUint32(4, 0x65736473); // esds
	//ES_Descriptor
	view.setUint8(12, 3); // ES_DescrTag
	view.setUint8(13, 34); // length
	view.setUint16(15, 2); // ES_ID
	// priority + flags byte = 0

	//DecoderConfigDescriptor
	view.setUint8(17, 4); // DecoderConfigDescrTag
	view.setUint8(18, 20); // length
	view.setUint8(19, 0x40); // objectTypeIndication = MPEG4 Audio ISO/IEC 14496-3
	view.setUint8(20, 0x15); // streamType = 5 (Audio), upStream = 0, reserved = 0 
	// 3 byte bufferSize = 0
	view.setUint32(24, trkdata.maxBitrate);
	view.setUint32(28, trkdata.avgBitrate);

	// DecoderSpecificInfo
	view.setUint8(32, 5); // DecSpecificInfoTag
	view.setUint8(33, 2); // length
	view.setUint16(34, (objectType<<11)|(freqIndex<<7)|(channelConf<<3));

	// SLConfigDescriptor
	view.setUint8(36, 6); //SLConfigDescrTag
	view.setUint8(37, 1); // length
	view.setUint8(38, 2); // MP4 = 2

	return {size: 39, box: [buffer]};
}

function mp4a(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(36),
		view = new DataView(buffer),
		atom = {size: 36, box: [buffer]};

	view.setUint32(4, 0x6d703461); // mp4a
	// 6 bytes reserved
	view.setUint16(14, 1); // data reference index
	// AudioSampleEntry data
	// 8 bytes reserved
	view.setUint16(24, 2); // channel count
	view.setUint16(26, 16); // sample size
	// 4 bytes reserved
	view.setUint32(32, 22050<<16); // sample rate

	// mp4a extends AudioSampleEntry with ESDBox
	add_atom(atom, esds(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function stsd(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(16),
		view = new DataView(buffer),
		atom = {size: 16, box: [buffer]};

	view.setUint32(4, 0x73747364); // stsd
	view.setUint32(12, 1); // entry count

	add_atom(atom, (trkdata.type === 'v'?avc1:mp4a)(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function stbl(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(8),
		view = new DataView(buffer),
		atom = {size: 8, box: [buffer]};

	view.setUint32(4, 0x7374626c);

	add_atom(atom, stsd(trkdata));
	add_atom(atom, stts(trkdata.dts_diffs));
	add_atom(atom, stsc(trkdata.sizes.length));
	add_atom(atom, stsz(trkdata.sizes));
	add_atom(atom, stco(trkdata.byte_offset));

	if(trkdata.type === 'v'){
		add_atom(atom, stss(trkdata.access_indices));
		if(trkdata.pd_diffs.length){
			add_atom(atom, ctts(trkdata.pd_diffs));
		}
	}

	view.setUint32(0, atom.size);
	return atom;
}

function minf(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(8),
		view = new DataView(buffer),
		atom = {size: 8, box: [buffer]};

	view.setUint32(4, 0x6d696e66);

	add_atom(atom, (trkdata.type === 'v'?vmhd:smhd)());
	add_atom(atom, dinf());
	add_atom(atom, stbl(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function mdia(trkdata){
	'use strict';
	var buffer = new ArrayBuffer(40),
		view = new DataView(buffer),
		atom = {size: 40, box: [buffer]};

	view.setUint32(4, 0x6d646961);
	// mdhd sub-box
	view.setUint32(8, 32);
	view.setUint32(12, 0x6d646864); // mdhd
	//view.setUint32(20, t); // creation time
	//view.setUint32(24, t); // modification time
	view.setUint32(28, trkdata.timescale);
	view.setUint32(32, Math.round(trkdata.duration*trkdata.timescale));
	view.setUint32(36, 0x55c40000); // 15-bit lang code 'und' & predefined = 0

	add_atom(atom, hdlr(trkdata));
	add_atom(atom, minf(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function trak(id, trkdata){
	'use strict';
	var buffer = new ArrayBuffer(100),
		view = new DataView(buffer),
		atom = {size: 100, box: [buffer]};

	view.setUint32(4, 0x7472616b); // trak
	// tkhd sub-box
	view.setUint32(8, 92);
	view.setUint32(12, 0x746b6864); // tkhd
	view.setUint32(16, 15); // version & flags
	//view.setUint32(20, t); // creation time
	//view.setUint32(24, t); // modification time
	view.setUint32(28, id);
	view.setUint32(36, trkdata.duration*1000); //or all 1s
	// reserved, layer(16) & alternate group(16)
	view.setUint32(48, trkdata.type == 'v' ? 0 : 0x01000000); // volume & more reserved
	// identity matrix:
	view.setUint32(52, 0x01000000  );
	view.setUint32(68, 0x00010000);
	view.setUint32(88, 0x40000000);
	view.setUint32(92, (trkdata.width&0xffff)<<16); // 16.16 width, ignoring fractional part
	view.setUint32(96, (trkdata.height&0xffff)<<16); // 16.16 height, ignoring fractional part

	add_atom(atom, mdia(trkdata));

	view.setUint32(0, atom.size);
	return atom;
}

function moov(tracks){
	'use strict';
	var d, buffer = new ArrayBuffer(116),
		view = new DataView(buffer),
		atom = {size: 116, box: [buffer]};
	
	d = Math.max.apply(Math,
		tracks.map(function(trkdata){ return trkdata.duration; })
	);

	view.setUint32(4, 0x6d6f6f76); // moov
	// mvhd sub-box
	view.setUint32(8, 108);
	view.setUint32(12, 0x6d766864); // mvhd
	//view.setUint32(20, t); // creation time
	//view.setUint32(24, t); // modification time
	view.setUint32(28, 1000); // timescale
	view.setUint32(32, Math.round(d*1000)); //duration
	view.setUint32(36, 0x00010000); // rate = 1.0
	view.setUint32(40, 0x01000000); // volume = 1.0 + reserved(16)
	// 64 bits reserved
	// identity matrix:
	view.setUint32(52, 0x00010000);
	view.setUint32(68, 0x00010000);
	view.setUint32(84, 0x40000000);
	// predefined (32)[6]
	view.setUint32(112, tracks.length); // next track id

	tracks.forEach(function(trkdata, i){ add_atom(atom, trak(i+1, trkdata)); });

	view.setUint32(0, atom.size);
	return atom;
}

function MP4(tracks){
	'use strict';
	var offset,
		atom = {size: 0, box: []};

	add_atom(atom, ftyp());

	offset = atom.size + 8;
	tracks.forEach(function(track){
		track.byte_offset = offset;
		offset += track.data.byteLength;
	});

	add_atom(atom, mdat(tracks));
	add_atom(atom, moov(tracks));
	return new Blob(atom.box, {type: 'video/mp4'});
}