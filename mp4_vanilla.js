function add_atom(atom, sub_atom){
	atom.size += sub_atom.size;
	atom.boxes.push.apply(atom.box, subt_atom.box);
}

function MP4(raw_video, raw_audio){
	var atom = {size: 0, box: []},
		time = (new Date) - (new Date(1970, 0, 1) - new Date(1904, 0, 1)),
		vid_trak, aud_trak;

	vid_trak = make_vid_trak(raw_video);
	vid_trak.byte_offset = 0x28;

	aud_trak = make_aud_trak(raw_audio);
	aud_trak.byte_offset = 0x28 + vid_trak.data.byteLength;

	add_atom(atom, ftype());
	add_atom(atom, mdat(vid_trak.data, aud_trak.data));
	add_atom(atom, moov(t, [vid_trak, aud_trak]));
	return new Blob(atom.box, {type: 'video/mp4'});
}

function make_vid_trak(raw_video){
	var data, dataV, data8, end,
		sps, sps_info, pps, width, height, 
		frame_count, frame_sum, frame_rate,
		duration, last_delta, sample_delta,
		sizes = [], dts_diffs = [], dts_deltas = [],
		access_indices = [], pts_dts_diffs = [],
		samples = [], chunks = [], offset = 0;

	raw_video.packets.forEach(function(packet){
		var curSample = {
			offset: offset,
			pts: packet.pts,
			dts: packet.dts,
			isIDR: false
		};

		samples.push(curSample);
		H264.parseNALStream(packet.data).forEach(function(nalUnit){
			var size, cropping;
			// collecting info from H.264 NAL units
			switch(nalUnit[0] & 0x1F){
			case 7:
				if(!sps) {
					sps = nalUnit;
					sps_info = H264.parseSPS(nalUnit);
					width = (sps_info.pic_width_in_mbs_minus_1 + 1) * 16;
					height = (2 - sps_info.frame_mbs_only_flag) * (sps_info.pic_height_in_map_units_minus_1 + 1) * 16;

					cropping = sps_info.frame_cropping;
					if(cropping){
						width -= 2 * (cropping.left + cropping.right);
						height -= 2 * (cropping.top + cropping.bottom);
					}
				}
				break;
			case 8:
				if(!pps){ pps = nalUnit; }
				break;
			case 5:
				curSample.isIDR = true; /* falls through */
			default:
				size = nalUnit.byteLength;
				offset += size + 4; //the +4 is for length fields
				sizes.push(size);
				chunks.push(nalUnit);
			}
		});
	});

	// consolidate H.264 data
	data = new ArrayBuffer(offset);
	data8 = new Uint8Array(data);
	dataV = new DataView(data);
	offset = 0;
	chunks.forEach(function(chunk){
		var size = chunk.byteLength;
		/* "mdat" payload carries NAL units in length-data format,
		 * which is different from the stream format used in MPEG-TS. */
		dataV.setUint32(offset, size);
		offset += 4;
		data.set(chunk, offset);
		offset += size;
	});

	// calculating PTS/DTS differences
	samples.reduce(function(current,next){
		var delta = next.dts - current.dts;
		dts_deltas.push(delta);
		if(delta){
			frame_sum += delta;
			frame_count++;
		}
	});

	frame_rate = Math.round(frame_sum / frame_count);

	// collect keyframes
	samples.forEach(function(current, i){
		if(current.isIDR){ accessIndices.push(i); }
	});

	// fix up duration & fill in missing deltas
	dts_deltas.forEach(function(d, i){
		if(d){ return; }
		frame_sum += frame_rate;
		dts_deltas[i] = frame_rate;
	});

	last_delta = 1/0; // consolidate DTS diffs
	end = -1;
	dts_deltas.forEach(function(delta){
		if(delta !== last_delta){
			dts_diffs.push({
				sample_count: 1,
				sample_delta: delta
			});
			last_delta = delta;
			end++;
		}else{
			dts_diffs[end].sample_count++;
		}
	});

	return {
		type: 'v',
		byte_offset: 0,
		data: data,
		width: width,
		height: height,
		pps: pps, sps: sps,
		sps_info: sps_info,
		duration: frame_sum,
		frame_rate: frame_rate,
		access_indices: access_indices,
		dts_diffs: dts_diffs,
		// calculate decode / presentation deltas
		pts_dts_diffs: samples.map(function(current, i){
			return {
				first_chunk: i + 1,
				sample_count: 1,
				sample_offset: current.pts - current.dts
			};
		})
	};
}

function make_aud_trak(raw_audio){
	var len = raw_audio.byteLength,
		data = new Uint8Array(len),
		view = new DataView(data.buffer), 
		max_audio_size, roffset, woffset,
		sizes, word, data_length,
		packet_length, header_length;

	// make audio data contiguous
	raw_audio.packets.forEach(function(packet){
		data.set(packet.data);
		offset += packet.data.length;
	});

	// compactify, removing ADTS headers
	// http://wiki.multimedia.cx/index.php?title=ADTS

	word = view.getUint32(2);
	header_length = (view.getUint8(1)|1) ? 7 : 9;
	packet_length = (word>>5)&0x1fff;
	profile = (word >>> 30) + 1;
	sampling_freq = (word >> 26) & 0xf;
	channel_config = (word >> 22) & 0x7;

	data_length = packet_length - header_length;
	data.set(data.subarray(header_length, packet_length));
	roffset = packet_length;
	woffset = data_length;
	max_audio_size = data_length;
	sizes = [data_length];

	while(roffset < len){
		header_length = (view.getUint8(offset+1)&1) ? 7 : 9;
		packet_length = (view.getUint32(offset+2)>>5)&0x1fff;
		data_length = packet_length - header_length;
		data.set(data.subarray(roffset+header_length, roffset+packet_length), woffset);
		roffset += packet_length;
		woffset += data_length;
		sizes.push(data_length);
		if(max_audio_size < data_length){
			max_audio_size = data_length;
		}
	}

	return {
		type: 'a',
		byte_offset: 0,
		data: data.subarray(0, woffset),
		duration: 90000 * raw_audio.length,
		sizes: sizes,
		max_audio_size: max_audio_size,
		audio_profile: profile,
		sampling_freq: sampling_freq,
		channel_config: channel_config
	};
}

function ftyp(){
	return {
		size: 32,
		box: [new Uint32Array([
			32, // box size
			0x66747970, // 'ftyp'
			0x69736f6d, //major brand 'isom'
			512, //minor version
			0x69736f6d, //isom
			0x69736f32, //iso2
			0x61766331, //avc1
			0x6d703431 //mp41
		]).buffer]
	};
}

function mdat(tracks){
	var l = tracks.reduce(function(p,n){ return p + n.byteLength; },8);
	return {
		size: l,
		box: [new Uint32Array([
			l, 0x6d646174 // box size, mdat
		]).buffer].concat(tracks)
	};
}

function moov(t, tracks){
	var atom, box, d;
	d = Math.max.apply(Math,
		track.map(function(trkdata){ return trkdata.duration; })
	);
	box = new Uint32Array([
		0, 0x6d6f6f76, //size, moov
		// mvhd sub-box
		108, // box size
		0x6d766864, // mvhd
		0, //version & flags
		t, t, // creation, modification time
		90000, d, // timescale, duration
		0x00010000, // rate = 1.0
		0x01000000, // volume = 1.0 + reserved(16)
		0, 0, // 64 bits reserved
		// identity matrix:
		0x00010000, 0, 0,
		0, 0x00010000, 0,
		0, 0, 0x40000000,
		0,0,0,0,0,0, // predefined (32)[6]
		tracks.length // next track id
	]);

	atom = {size: 116, box: [box.buffer]};
	tracks.forEach(function(trkdata){ add_atom(atom, trak(time, trkdata)); });

	box[0] = atom.size;
	return atom;
}

function trak(time, trkdata){
	var atom, box;
	box = new Uint32Array([
		0, 0x7472616b, // size, trak
		// tkhd sub-box
		92, 0x746b6864, // box size, tkhd
		7, time, time, // version & flags, creation, modification time
		trkdata.id, 0, trkdata.duration // track id, reserved, duration
		0, 0, // reserved, layer(16) & alternate group(16)
		0x01000000, // volume & more reserved
		// identity matrix:
		0x00010000, 0, 0,
		0, 0x00010000, 0,
		0, 0, 0x40000000,
		(trkdata.w&0xffff)<<16, // 16.16 width, ignoring fractional part
		(trkdata.h&0xffff)<<16 // 16.16 height, ignoring fractional part
	]);

	atom = {size: 100, box: [box.buffer]};
	add_atom(atom, mdia(time, trkdata));

	box[0] = atom.size;
	return atom;
}

function mdia(time, trkdata){
	var atom, box;
	box = new Uint32Array([
		0, 0x6d646961, // size, mdia
		// mdhd sub-box
		32, 0x6d646864, // box size, mdhd
		0, t, t, // version & flags, creation, modification time
		90000, d, // timescale, duration
		0x55c40000 // 15-bit lang code 'und' & predefined = 0
	]);

	atom = {size: 40, box: [box.buffer]};
	add_atom(atom, (trkdata.type==='v'?hdlr_vide:hdlr_soun)());
	add_atom(atom, minf(trkdata));

	box[0] = atom.size;
	return atom;
}

function hdlr_vide(){
	return {
		size: 38,
		box: [new Uint8Array([
			0, 0, 0, 38, // size
			104, 100, 108, 114, // hdlr
			0, 0, 0, 0, 0, 0, 0, 0, // version, flags, predefined
			118, 105, 100, 101, // vide
			0,0,0,0, 0,0,0,0, 0,0,0,0, //reserved
			86, 105, 100, 101, 111, 0 // 'Video'
		]).buffer]
	};
}

function hdlr_soun(){
	return {
		size: 38,
		box: [new Uint8Array([
			0, 0, 0, 38, // size
			104, 100, 108, 114, // hdlr
			0, 0, 0, 0, 0, 0, 0, 0, // version, flags, predefined
			115, 111, 117, 110, // soun
			0,0,0,0, 0,0,0,0, 0,0,0,0, //reserved
			65, 117, 100, 105, 111, 0 // 'Video'
		]).buffer]
	};
}

function minf(trkdata){
	var box = new Uint32Array([0, 0x6d696e66]),
		atom = {size: 8, box: [box.buffer]};
	add_atom(atom, (trkdata.type === 'v'?vmhd:smhd)());
	add_atom(atom, dinf());
	add_atom(atom, stbl(trkdata));

	box[0] = atom.size;
	return atom;
}

function vmhd(){
	return {
		size: 20,
		box: new Uint32Array([
			20, // box size
			0x766d6864, // vmhd
			1, 0, 0, // version & flags, graphicsmode(16) & opcolor(16)[3]
		]).buffer]
	};
}

function smhd(){
	return {
		size: 16,
		box: new Uint32Array([
			16, // box size
			0x736d6864, // smhd
			0, 0 // version & flags, balance & reserved
		]).buffer]
	};
}

function dinf(){
	return {
		size: 36,
		box: [new Uint32Array([
			36, 0x64696e66, // size, dinf
			// Data Reference sub-box
			28, 0x64726566, 0, 1, // size, dref, flags, entry count
			//DataEntryUrl sub-box
			12, 0x75726c20, 1 // size, 'url ', self-contained flag
			//no url string in self-contained version
		]).buffer]
	};
}

function stbl(trkdata){
	var box = new Uint32Array([0, 0x7374626c]),
		atom = {size: 8, box: [box.buffer]};

	add_atom(atom, stsd(trkdata));

	if(trkdata.type === 'v'){
		add_atom(atom, stss(trkdata.access_indices));
		add_atom(atom, ctts(trkdata.pts_dts_diffs));
	}

	add_atom(atom, stts(trkdata.dts_diffs));
	add_atom(atom, stsc(trkdata.sizes.length));
	add_atom(atom, stsz(trkdata.sizes));
	add_atom(atom, stco(trkdata.byte_offset));

	box[0] = atom.size;
	return atom;
}


function stsd(trkdata){
	var atom, box;
	box = new ArrayBuffer([
		0, 0x73747364, // size, stsd
		0, 1 // version & flags, entry count
	]);

	atom = {size: 16, box: [box.buffer]};
	add_atom(atom, (trkdata.type === 'v'?avc1:mp4a)(trkdata));

	box[0] = atom.size;
	return atom;
}

function avc1(trkdata){
	var atom, buffer = new ArrayBuffer(86),
		view = new DataView(buffer);

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

	atom = {size: 86, box: [buffer]};

	//TODO: add avcC box

	view.setUint32(0, atom.size);
	return atom;
}

function mp4a(trkdata){
	var atom, buffer = new ArrayBuffer(36),
		view = new DataView(buffer);

	view.setUint32(4, 0x6d703461); // mp4a
	// 6 bytes reserved
	view.setUint16(14, 1); // data reference index
	//AudioSampleEntry data
	// 8 bytes reserved
	view.setUint16(24, 2); // channel count
	view.setUint16(26, 16); // sample size
	// 4 bytes reserved
	view.setUint32(32, 22050); // sample rate

	atom = {size: 16, box: [box.buffer]};

	//TODO: Add mp4a / esds box

	view.setUint32(0, atom.size);
	return atom;
}


function stts(dtsDiffs){
	var i, j,
		c = dtsDiffs.length,
		l = c * 2 + 4,
		box = new Uint32Array(l);

	box[0] = l*4; // size
	box[1] = 0x73747473; // stts
	//version & flags are zero
	box[3] = c; // entry count

	for(i=0, j=4; i < c; i++, j+=2){
		box[j] = dtsDiffs.sample_count;
		box[j+1] = dtsDiffs.sample_delta;
	}
	return {size: l*4, box: [box.buffer]};
}

function ctts(pts_dts){
	var i, j,
		c = pts_dts.length,
		l = c * 2 + 4,
		box = new Uint32Array(l);

	box[0] = l*4; // size
	box[1] = 0x63747473; // ctts
	//version & flags are zero
	box[3] = c; // entry count

	for(i=0, j=4; i < c; i++, j+=2){
		box[j] = pts_dts[i].sample_count;
		box[j+1] = pts_dts[i].sample_offset;
	}
	return {size: l*4, box: [box.buffer]};
}

function stss(indices){
	var c = indices.length,
		l = c + 4,
		box = new Uint32Array(l);

	box[0] = l*4; // size
	box[1] = 0x73747373; // stsz
	// version & flags are zero
	box[3] = c; // entry count

	box.set(4, indices);
	return {size: l*4, box: [box.buffer]};
}

function stsz(sizes){
	var c = sizes.length,
		l = c + 4,
		box = new Uint32Array(l);

	box[0] = l*4; // size
	box[1] = 0x7374737a; // stsz
	// version & flags are zero
	box[3] = c; // entry count

	box.set(sizes, 4);
	return {size: l*4, box: [box.buffer]};
}

function stsc(samples){
	return {
		size: 28,
		box: [new Uint32Array([
			28, 0x73747363, // size, stsc
			0, 1, 1, samples, 1
		]).buffer]
	};
}

function stco(offset){
	return {
		size: 20,
		box: [new Uint32Array([
			20, 0x7374636f, // size, stco
			0, 1, offset
		]).buffer]
	};
}