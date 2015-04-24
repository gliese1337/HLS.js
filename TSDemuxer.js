var TSDemuxer = (function(){
	"use strict";

	function Stream(){
		this.program = 0xffff;  // program number (1,2 ...)
		this.id = 0;            // stream number in program
		this.type = 0xff;
		this.stream_id = 0;     // MPEG stream id
		this.content_type = 0;  // 1 - audio, 2 - video
		this.dts = 0;           // current MPEG stream DTS (presentation time for audio, decode time for video)
		this.first_pts = 0;
		this.last_pts = 0;
		this.frame_rate = 0;    // current time for show frame in ticks (90 ticks = 1 ms, 90000/frame_rate=fps)
		this.frame_num = 0;     // frame counter

		this.bufs = [];         // ES output file
		this.byteLength = 0;

		this.nal_ctx = 0;
		this.nal_frame_num = 0; // JVT NAL (h.264) frame counter
		
		Object.defineProperties(this,{
			fps: {
				get: function(){ return 90000/this.frame_rate; },
				enumerable: true
			},
			length: {
				get: function(){ return (this.last_pts+this.frame_rate-this.first_pts)/90000; },
				enumerable: true
			}
		});
	}

	Stream.prototype.write = function(mem, ptr, len){
		this.bufs.push(new Uint8Array(mem.buffer, ptr, len));
		this.byteLength += len;
	};

	Stream.prototype.finalize = function(){
		var offset = 0,
			output = new Uint8Array(this.byteLength);
		this.bufs.forEach(function(b){
			output.set(b, offset);
			offset += b.byteLength;
		});
		this.bufs = [];
		this.byteLength = 0;
		return output;
	};

	var pmt = {
		mem: new DataView(new ArrayBuffer(512)),
		ptr: 0, len: 0, offset: 0,
		reset: function(l){ this.len=l; this.offset=0; }
	};

	var stream_type = {
		unknown     : 0,
		audio       : 1,
		video       : 2,

		// http://en.wikipedia.org/wiki/Program-specific_information#Elementary_stream_types
		data        : 0,
		mpeg2_video : 1,
		h264_video  : 2,
		vc1_video   : 3,
		ac3_audio   : 4,
		mpeg2_audio : 5,
		lpcm_audio  : 6,
		aac_audio   : 7
	};

	function get_stream(pids, pid){
		if(!pids.hasOwnProperty(pid)){ pids[pid] = new Stream(); }
		return pids[pid];
	}

	function get_media_type(type_id){
		var tlist =
			[ stream_type.unknown, stream_type.video, stream_type.video, stream_type.video,
				stream_type.audio,stream_type.audio,stream_type.audio,stream_type.audio ];
		return tlist[get_stream_type(type_id)];
	}

	function get_stream_type(type_id){
		switch(type_id){
		case 0x01:
		case 0x02:
			return stream_type.mpeg2_video;
		case 0x80:
			return stream_type.mpeg2_video;
		case 0x1b:
			return stream_type.h264_video;
		case 0xea:
			return stream_type.vc1_video;
		case 0x81:
		case 0x06:
			return stream_type.ac3_audio;
		case 0x03:
		case 0x04:
			return stream_type.mpeg2_audio;
		case 0x0f:
			return stream_type.aac_audio;
		}

		return stream_type.data;
	}

	function decode_pts(mem, p){
		var pts=((mem.getUint8(p)&0xe)<<29);
		pts|=((mem.getUint8(p+1)&0xff)<<22);
		pts|=((mem.getUint8(p+2)&0xfe)<<14);
		pts|=((mem.getUint8(p+3)&0xff)<<7);
		pts|=((mem.getUint8(p+4)&0xfe)>>1);

		return pts;
	}

	function decode_pat(mem, ptr, len, pids, pstart){
		var s, i, n, l, pid, program;
		if(pstart){
			if(len<1){ return -6; }
			ptr+=1; // skip pointer field
			len-=1;
		}

		if(mem.getUint8(ptr)!==0x00){ return 0; } // not a PAT after all
		if(len<8){ return -7; }

		l=mem.getUint16(ptr+1);
		if(l&0xb000!==0xb000){ return -8; }

		l&=0x0fff;
		len-=3;

		if(l>len){ return -9; }

		len-=5;
		ptr+=8;
		l-=5+4;

		if(l%4){ return -10; }

		n=l/4;
		for(i=0;i<n;i++){
			program=mem.getUint16(ptr);
			pid=mem.getUint16(ptr+2);

			if(pid&0xe000!==0xe000){ return -11; }

			pid&=0x1fff;
			ptr+=4;

			s=get_stream(pids, pid);
			s.program=program;
			s.type=0xff;
		}

		return 0;
	}

	function memcpy(dstm, dstp, srcm, srcp, len){
		(new Uint8Array(dstm.buffer, dstp, len)).set(new Uint8Array(srcm.buffer, srcp, len));
	}

	function decode_pmt(mem, ptr, len, pids, s, pstart){
		var ss, ll, l, n, pid, type;
		if(pstart){
			if(len<1){ return -12; }

			ptr+=1;     // skip pointer field
			len-=1;

			if(mem.getUint8(ptr)!==0x02){ return 0; } // not a PMT after all
			if(len<12){ return -13; }

			l=mem.getUint16(ptr+1);
			if(l&0x3000!==0x3000){ return -14; }

			l=(l&0x0fff)+3;
			if(l>512){ return -141; }

			pmt.reset(l);

			ll=len>l?l:len;
			memcpy(pmt.mem, pmt.ptr, mem, ptr, ll);
			pmt.offset+=ll;

			if(pmt.offset<pmt.len){ return 0; } // wait for next part
		}else{
			if(!pmt.offset){ return -142; }

			l=pmt.len-pmt.offset;
			ll=len>l?l:len;
			memcpy(pmt.mem, pmt.ptr+pmt.offset, mem, ptr, ll);
			pmt.offset+=ll;

			if(pmt.offset<pmt.len){ return 0; } // wait for next part
		}

		mem=pmt.mem;
		ptr=pmt.ptr;
		l=pmt.len;
		n=(mem.getUint16(ptr+10)&0x0fff)+12;
		if(n>l){ return -15; }

		ptr+=n;
		len-=n;
		l-=n+4;

		while(l){
			if(l<5){ return -16; }

			type=mem.getUint8(ptr);
			pid=mem.getUint16(ptr+1);
			if(pid&0xe000!==0xe000){ return -17; }

			pid&=0x1fff;
			ll=(mem.getUint16(ptr+3)&0x0fff)+5;
			if(ll>l){ return -18; }

			ptr+=ll;
			l-=ll;

			ss=get_stream(pids, pid);
			if(ss.program!==s.program || ss.type!==type){
				ss.program=s.program;
				ss.type=type;
				ss.id=++s.id;
				ss.content_type = get_media_type(type);
			}
		}

		return 0;
	}

	function decode_pes(mem, ptr, len, pids, s, pstart){
		// PES (Packetized Elementary Stream)
		var i, l, pts, dts, hlen, bitmap, stream_id;
		if(pstart){
			// PES header
			if(len<6){ return -20; }
			if(mem.getUint16(ptr) !== 0 || mem.getUint8(ptr+2) !== 1){
				return -21;
			}

			stream_id=mem.getUint8(ptr+3);
			l=mem.getUint16(ptr+4);

			ptr+=6;
			len-=6;

			if( (stream_id>=0xbd && stream_id<=0xbf) ||
				(stream_id>=0xc0 && stream_id<=0xdf) ||
				(stream_id>=0xe0 && stream_id<=0xef) ||
				(stream_id>=0xfa && stream_id<=0xfe)   ){
				// PES header extension

				if(len<3){ return -22; }

				bitmap=mem.getUint8(ptr+1);
				hlen=mem.getUint8(ptr+2)+3;
				if(len<hlen){ return -23; }
				if(l>0){ l-=hlen; }

				switch(bitmap&0xc0){
				case 0x80:  // PTS only
					if(hlen>=8){
						pts=decode_pts(mem, ptr+3);
						if(s.dts>0 && pts>s.dts){ s.frame_rate=pts-s.dts; }

						s.dts=pts;
						if(pts>s.last_pts){ s.last_pts=pts; }
						if(!s.first_pts && s.frame_num===(s.content_type===stream_type.video?1:0)){
							s.first_pts=pts;
						}
					}
					break;
				case 0xc0:  // PTS,DTS
					if(hlen>=13){
						pts=decode_pts(mem, ptr+3);
						dts=decode_pts(mem, ptr+8);
						if(s.dts>0 && dts>s.dts){ s.frame_rate=dts-s.dts; }

						s.dts=dts;
						if(pts>s.last_pts){ s.last_pts=pts; }
						if(!s.first_pts && s.frame_num===(s.content_type===stream_type.video?1:0)){
							s.first_pts=dts;
						}
					}
					break;
				}

				ptr+=hlen;
				len-=hlen;

				s.stream_id=stream_id;
				s.frame_num++;
			}else{
				s.stream_id=0;
			}
		}

		if(s.stream_id && s.content_type !== stream_type.unknown){
			if(s.type===0x1b){       // JVT NAL (h.264)
				for(i=0;i<len;i++){
					s.nal_ctx=(s.nal_ctx<<8)+mem.getUint8(ptr+i);
					if((s.nal_ctx&0xffffff1f)===0x00000109){ // NAL access unit
						s.nal_frame_num++;
					}
				}
			}

			s.write(mem, ptr, len);
		}

		return 0;
	}

	function demux_packet(mem, ptr, len, pids){
		var s, l, pid, flags, payload_start;
		if(len!==188){ return -1; }  // invalid packet length
		if(mem.getUint8(ptr)!==0x47){ return -2; }   // invalid packet sync byte

		pid=mem.getUint16(ptr+1);
		flags=mem.getUint8(ptr+3);

		if(pid&0x8000){ return -3; }// transport error
		if(flags&0xc0){ return -4; }// scrambled

		payload_start=pid&0x4000;
		pid&=0x1fff;

		//check if payload exists
		if(pid === 0x1fff || !(flags&0x10)){ return 0; }

		ptr+=4;
		len-=4;

		if(flags&0x20){ // skip adaptation field
			l=mem.getUint8(ptr)+1;
			if(l>len){ return -5; }

			ptr+=l;
			len-=l;
		}

		if(!pid){ return decode_pat(mem, ptr, len, pids, payload_start); }

		s=get_stream(pids, pid);
		if(s.program===0xffff){ return 0; }
		if(s.type===0xff){
			return decode_pmt(mem, ptr, len, pids, s, payload_start);
		}
		return decode_pes(mem, ptr, len, pids, s, payload_start);
	}

	function demux_file(buffer, ptr, len, pids){
		var length, n, l=188,
			mem = new DataView(buffer);

		for(ptr=0;true;ptr+=l){
			length = len - ptr;
			if(!length){ return 0; }
			if(length<l){ return -1; } // incompleted TS packet

			n = demux_packet(mem, ptr, l, pids);
			if(n){ return n; }  // invalid packet
		};

		return 0;
	}

	function TSDemuxer(){
		this.pids = {};
	}

	TSDemuxer.prototype.process = function(buffer, offset, len){
		var n;
		if(buffer instanceof ArrayBuffer){
			n = demux_file(buffer, offset||0, len||buffer.byteLength, this.pids);
		}else{
			n = demux_file(buffer.buffer, buffer.byteOffset, buffer.byteLength, this.pids);
		}
		if(n !== 0){ throw new Error("Demuxing Error #"+(-n)); }
	};

	Object.defineProperties(TSDemuxer.prototype,{
		streams: {
			get: function(){
				var p = this.pids;
				return Object.keys(p).map(function(id){ return p[id]; });
			}, enumerable: true
		},
		audio: {
			get: function(){
				return this.streams.filter(function(s){ return s.content_type === 1; });
			}, enumerable: true
		},
		video: {
			get: function(){
				return this.streams.filter(function(s){ return s.content_type === 2; });
			}, enumerable: true
		}
	});

	return TSDemuxer;
}());