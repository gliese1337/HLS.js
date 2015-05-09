var parseSPS = (function(){
	"use strict";

	function Bitstream(view){
		this.view = view;
		this.bitoffset = 0;
	}

	Bitstream.prototype.ExpGolomb = function(){
		var byt, bit = 0,
			byteoffset = this.bitoffset>>3,
			skip = this.bitoffset&7,
			code = 1, zeros = -1;

		byt = this.view.getUint8(byteoffset) << skip;
		do {
			bit = byt & 0x80;
			byt <<= 1;
			zeros++;
			skip++;
			if(skip === 8){
				skip = 0;
				byteoffset++;
				byt = this.view.getUint8(byteoffset);
			}
		}while(!bit);
		while(zeros > 0){
			code = (code << 1)|((byt & 0x80) >>> 7);
			byt <<= 1;
			skip++;
			zeros--;
			if(skip === 8){
				skip = 0;
				byteoffset++;
				byt = this.view.getUint8(byteoffset);
			}
		}
		
		this.bitoffset = (byteoffset<<3)|skip;
		return code - 1;
	};

	Bitstream.prototype.SkipExpGolomb = function(){
		var byt, bit = 0,
			byteoffset = this.bitoffset>>3,
			skip = this.bitoffset&7,
			zeros = -1;

		byt = this.view.getUint8(byteoffset) << skip;
		do {
			bit = byt & 0x80;
			byt <<= 1;
			zeros++;
			skip++;
			if(skip === 8){
				skip = 0;
				byteoffset++;
				byt = this.view.getUint8(byteoffset);
			}
		}while(!bit);
		this.bitoffset = (byteoffset<<3)+skip+zeros;
	};

	Bitstream.prototype.SignedExpGolomb = function(){
		var code = this.ExpGolomb();
		return code&1?(code+1)>>>1:-(code>>>1);
	};

	Bitstream.prototype.readBit = function(){
		var bit, skip = this.bitoffset&7,
			byteoffset = this.bitoffset>>3;

		bit = (this.view.getUint8(byteoffset) >> (7 - skip))&1;
		this.bitoffset++;
		return bit;
	};

	function scaling_list(stream, sizeOfScalingList){
		var j, deltaScale,
			lastScale = 8,
			nextScale = 8;
		for(j = 0; j < sizeOfScalingList; j++){
			if(nextScale !== 0){
				deltaScale = stream.SignedExpGolomb();
				nextScale = (lastScale + deltaScale + 256) % 256;
			}
			if(nextScale){ lastScale = nextScale; }
		}
	}

	return function parseSPS(nal){
		var i, stream = new Bitstream(new DataView(nal.buffer, nal.byteOffset+3)),
			profile_idc, level_idc,
			profile_compatibility,
			pic_width_in_mbs_minus1,
			pic_height_in_map_units_minus1,
			chroma_format_idc,
			pic_order_cnt_type,
			num_ref_frames_in_pic_order_cnt_cycle,
			frame_mbs_only_flag,
			frame_cropping_flag,
			left_offset = 0,
			right_offset = 0,
			top_offset = 0,
			bottom_offset = 0;
			
		profile_idc = nal[0];
		profile_compatibility = nal[1];
		level_idc = nal[2];
		stream.SkipExpGolomb(); // seq_parameter_set_id

		if(	profile_idc === 100 || profile_idc === 110 ||
			profile_idc === 122 || profile_idc === 244 || profile_idc === 44 ||
			profile_idc === 83  || profile_idc === 86  || profile_idc === 118 ||
			profile_idc === 128 ){
			chroma_format_idc = stream.ExpGolomb();
			if(chroma_format_idc === 3){
				stream.bitoffset++; // separate color plane flag
			}
			stream.SkipExpGolomb(); // bit_depth_luma_minus8
			stream.SkipExpGolomb(); // bit_depth_chroma_minus8
			stream.bitoffset++; // qpprime_y_zero_transform_bypass_flag
			if(stream.readBit()){ //seq_scaling_matrix_present_flag
				for(i = 0; i < 6; i++){
					if(stream.readBit()){ //seq_scaling_list_present_flag
						scaling_list(stream, 16);
					}
				}
				for(0; i < ((chroma_format_idc !== 3)?8:12); i++){
					if(stream.readBit()){ //seq_scaling_list_present_flag
						scaling_list(stream, 64);
					}
				}
			}
		}

		stream.SkipExpGolomb(); // log2_max_frame_num_minus4
		pic_order_cnt_type = stream.ExpGolomb();
		if(pic_order_cnt_type === 0){
			stream.ExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
		}else if(pic_order_cnt_type === 1){
			stream.bitoffset++; // delta_pic_order_always_zero_flag
			stream.SkipExpGolomb(); // offset_for_non_ref_pic se(v)
			stream.SkipExpGolomb(); // offset_for_top_to_bottom_field se(v)
			num_ref_frames_in_pic_order_cnt_cycle = stream.ExpGolomb();
			for(i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++){
				stream.ExpGolomb(); // offset_for_ref_frame[i] se(v)
			}
		}
		stream.SkipExpGolomb(); // max_num_ref_frames
		stream.bitoffset++; // gaps_in_frame_num_value_allowed_flag
		pic_width_in_mbs_minus1 = stream.ExpGolomb();
		pic_height_in_map_units_minus1 = stream.ExpGolomb();
		frame_mbs_only_flag = stream.readBit();
		if(!frame_mbs_only_flag){
			stream.bitoffset++; // mb_adaptive_frame_field_flag
		}
		stream.bitoffset++; // direct_8x8_inference_flag
		frame_cropping_flag = stream.readBit();
		if(frame_cropping_flag){
			left_offset = stream.ExpGolomb();
			right_offset = stream.ExpGolomb();
			top_offset = stream.ExpGolomb();
			bottom_offset = stream.ExpGolomb();
		}
		/* vui_parameters_present_flag u(1)
		if(vui_parameters_present_flag)
			vui_parameters() */
		return {
			profile_idc: profile_idc,
			level_idc: level_idc,
			profile_compatibility: profile_compatibility,
			frame_mbs_only_flag: frame_mbs_only_flag,
			pic_width_in_mbs: pic_width_in_mbs_minus1+1,
			pic_height_in_map_units: pic_height_in_map_units_minus1+1,
			frame_cropping_flag: frame_cropping_flag,
			frame_cropping: {
				left: left_offset,
				right: right_offset,
				top: top_offset,
				bottom: bottom_offset
			}
		};
	};
}());