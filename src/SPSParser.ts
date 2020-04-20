function ExpGolomInit(view: DataView, bitoffset: number) {
  let bit = 0;
  let byteoffset = bitoffset>>3;
  let skip = bitoffset&7;
  let zeros = -1;

  let byt = view.getUint8(byteoffset) << skip;
  do {
    bit = byt & 0x80;
    byt <<= 1;
    zeros++;
    skip++;
    if(skip === 8){
      skip = 0;
      byteoffset++;
      byt = view.getUint8(byteoffset);
    }
  }while(!bit);

  return { zeros, skip, byt, byteoffset };
}

class Bitstream {
  public bitoffset = 0;
	constructor (public view: DataView) {}

  ExpGolomb() {
    const { view } = this;
    let {
      zeros, skip, byt, byteoffset
    } = ExpGolomInit(view, this.bitoffset);
    
    let code = 1;
    while(zeros > 0){
      code = (code << 1)|((byt & 0x80) >>> 7);
      byt <<= 1;
      skip++;
      zeros--;
      if(skip === 8){
        skip = 0;
        byteoffset++;
        byt = view.getUint8(byteoffset);
      }
    }
    
    this.bitoffset = (byteoffset<<3)|skip;
    return code - 1;
  }

  SkipExpGolomb() {
    const {
      zeros, skip, byteoffset
    } = ExpGolomInit(this.view, this.bitoffset);
    this.bitoffset = (byteoffset<<3)+skip+zeros;
  }

  SignedExpGolomb() {
    const code = this.ExpGolomb();
    return code&1?(code+1)>>>1:-(code>>>1);
  }

  readBit(): 0 | 1{
    const skip = this.bitoffset&7;
    const byteoffset = this.bitoffset>>3;
    this.bitoffset++;
    return ((this.view.getUint8(byteoffset) >> (7 - skip))&1) as 0|1;
  }
}

function scaling_list(stream: Bitstream, sizeOfScalingList: number){
  let lastScale = 8;
  let nextScale = 8;
  for(let j = 0; j < sizeOfScalingList; j++){
    if(nextScale !== 0){
      const deltaScale = stream.SignedExpGolomb();
      nextScale = (lastScale + deltaScale + 256) % 256;
    }
    if(nextScale){ lastScale = nextScale; }
  }
}

export type SPSInfo = {
  profile_idc: number;
  level_idc: number;
  profile_compatibility: number;
  frame_mbs_only_flag: 0|1;
  pic_width_in_mbs: number;
  pic_height_in_map_units: number;
  frame_cropping_flag: 0|1;
  frame_cropping: {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
};

export function parseSPS(nal: Uint8Array): SPSInfo {
  const stream = new Bitstream(new DataView(nal.buffer, nal.byteOffset+4));
    
  const profile_idc = nal[1];
  const profile_compatibility = nal[2];
  const level_idc = nal[3];
  stream.SkipExpGolomb(); // seq_parameter_set_id

  if(	profile_idc === 100 || profile_idc === 110 ||
    profile_idc === 122 || profile_idc === 244 || profile_idc === 44 ||
    profile_idc === 83  || profile_idc === 86  || profile_idc === 118 ||
    profile_idc === 128 ){
    const chroma_format_idc = stream.ExpGolomb();
    let limit = 8;
    if(chroma_format_idc === 3) {
      limit = 12;
      stream.bitoffset++; // separate color plane flag
    }
    stream.SkipExpGolomb(); // bit_depth_luma_minus8
    stream.SkipExpGolomb(); // bit_depth_chroma_minus8
    stream.bitoffset++; // qpprime_y_zero_transform_bypass_flag
    if(stream.readBit()){ //seq_scaling_matrix_present_flag
      let i = 0;
      for(; i < 6; i++){
        if(stream.readBit()){ //seq_scaling_list_present_flag
          scaling_list(stream, 16);
        }
      }
      for(; i < limit; i++){
        if(stream.readBit()){ //seq_scaling_list_present_flag
          scaling_list(stream, 64);
        }
      }
    }
  }

  stream.SkipExpGolomb(); // log2_max_frame_num_minus4
  const pic_order_cnt_type = stream.ExpGolomb();
  if(pic_order_cnt_type === 0){
    stream.ExpGolomb(); // log2_max_pic_order_cnt_lsb_minus4
  }else if(pic_order_cnt_type === 1){
    stream.bitoffset++; // delta_pic_order_always_zero_flag
    stream.SkipExpGolomb(); // offset_for_non_ref_pic se(v)
    stream.SkipExpGolomb(); // offset_for_top_to_bottom_field se(v)
    const num_ref_frames_in_pic_order_cnt_cycle = stream.ExpGolomb();
    for(let i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++){
      stream.ExpGolomb(); // offset_for_ref_frame[i] se(v)
    }
  }

  stream.SkipExpGolomb(); // max_num_ref_frames
  stream.bitoffset++; // gaps_in_frame_num_value_allowed_flag
  const pic_width_in_mbs = stream.ExpGolomb() + 1;
  const pic_height_in_map_units = stream.ExpGolomb() + 1;
  const frame_mbs_only_flag = stream.readBit();
  if(!frame_mbs_only_flag){
    stream.bitoffset++; // mb_adaptive_frame_field_flag
  }

  stream.bitoffset++; // direct_8x8_inference_flag
  const frame_cropping_flag = stream.readBit();
  
  let left_offset = 0;
  let right_offset = 0;
  let top_offset = 0;
  let bottom_offset = 0;
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
    profile_idc,
    level_idc,
    profile_compatibility,
    frame_mbs_only_flag,
    pic_width_in_mbs,
    pic_height_in_map_units,
    frame_cropping_flag,
    frame_cropping: {
      left: left_offset,
      right: right_offset,
      top: top_offset,
      bottom: bottom_offset
    }
  };
}