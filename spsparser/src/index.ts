import { Bitstream } from "./bitstream";
import { getVUIParams, VUIParams } from "./vui";

export type FrameCropping = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export { VUIParams, Bitstream };

export type SPSInfo = {
  sps_id: number;
  profile_idc: number;
  level_idc: number;
  profile_compatibility: number;
  frame_mbs_only_flag: 0|1;
  pic_width_in_mbs: number;
  pic_height_in_map_units: number;
  frame_cropping_flag: 0|1;
  frame_cropping: FrameCropping;

  chroma_format_idc: number;
  bit_depth_luma: number;
  bit_depth_chroma: number;
  color_plane_flag: 0|1;
  qpprime_y_zero_transform_bypass_flag: 0|1;
  seq_scaling_matrix_present_flag: 0|1;
  seq_scaling_matrix: number[][];
  log2_max_frame_num: number;
  pic_order_cnt_type: number;
  delta_pic_order_always_zero_flag: 0|1;
  offset_for_non_ref_pic: number;
  offset_for_top_to_bottom_field: number;
  offset_for_ref_frame: number[];
  log2_max_pic_order_cnt_lsb: number;

  max_num_ref_frames: number;
  gaps_in_frame_num_value_allowed_flag: 0|1;
  mb_adaptive_frame_field_flag: 0|1;
  direct_8x8_inference_flag: 0|1;
  vui_parameters_present_flag: 0|1;
  vui_parameters: VUIParams;
};

function scaling_list(stream: Bitstream, sizeOfScalingList: number, use_default: number[], i: number): number[] {
  let lastScale = 8;
  let nextScale = 8;
  const scalingList = [];
  for (let j = 0; j < sizeOfScalingList; j++) {
    if (nextScale !== 0) {
      const deltaScale = stream.SignedExpGolomb();
      nextScale = (lastScale + deltaScale + 256) % 256;
      use_default[i] = +(j === 0 && nextScale === 0);
    }
    if (nextScale) { lastScale = nextScale; }
    scalingList[j] = lastScale;
    
  }
  return scalingList;
}

function getFrameCropping(flag: 0|1, stream: Bitstream): FrameCropping {
  if (!flag) return { left: 0, right: 0, top: 0, bottom: 0 };

  const left = stream.ExpGolomb();
  const right = stream.ExpGolomb();
  const top = stream.ExpGolomb();
  const bottom = stream.ExpGolomb();
  return { left, right, top, bottom };
}

export function parse(nalu: Uint8Array): SPSInfo {
  if ((nalu[0] & 0x1F) !== 7) throw new Error("Not an SPS unit");
 
  const stream = new Bitstream(new DataView(nalu.buffer, nalu.byteOffset + 4));

  const profile_idc = nalu[1];
  const profile_compatibility = nalu[2];
  const level_idc = nalu[3];
  const sps_id = stream.ExpGolomb();

  let chroma_format_idc = 0;
  let bit_depth_luma = 0;
  let bit_depth_chroma = 0;
  let color_plane_flag: 0|1 = 0;
  let qpprime_y_zero_transform_bypass_flag: 0|1 = 0;
  let seq_scaling_matrix_present_flag: 0|1 = 0;

  const scaling_list_4x4: number[][] = [];
  const scaling_list_8x8: number[][] = [];
  const use_default_scaling_matrix_4x4_flag: number[] = [];
  const use_default_scaling_matrix_8x8_flag: number[] = [];

  if (profile_idc === 100 || profile_idc === 110 ||
      profile_idc === 122 || profile_idc === 244 || profile_idc === 44 ||
      profile_idc === 83  || profile_idc === 86  || profile_idc === 118 ||
      profile_idc === 128 || profile_idc === 138 || profile_idc === 139 ||
      profile_idc === 134 || profile_idc === 135) {
    chroma_format_idc = stream.ExpGolomb();
    let limit = 8;
    if (chroma_format_idc === 3) {
      limit = 12;
      color_plane_flag = stream.readBit();
    }
    bit_depth_luma = stream.ExpGolomb() + 8;
    bit_depth_chroma = stream.ExpGolomb() + 8;
    qpprime_y_zero_transform_bypass_flag = stream.readBit();
    seq_scaling_matrix_present_flag = stream.readBit();
    if (seq_scaling_matrix_present_flag) {
      let i = 0;
      for (; i < 6; i++) {
        if (stream.readBit()) { //seq_scaling_list_present_flag
          scaling_list_4x4.push(
            scaling_list(
              stream, 16,
              use_default_scaling_matrix_4x4_flag, i,
            )
          );
        }
      }
      for (; i < limit; i++) {
        if (stream.readBit()) { //seq_scaling_list_present_flag
          scaling_list_8x8.push(
            scaling_list(
              stream, 64,
              use_default_scaling_matrix_8x8_flag, i - 6,
            )
          );
        }
      }
    }
  }

  const log2_max_frame_num = stream.ExpGolomb() + 4;
  const pic_order_cnt_type = stream.ExpGolomb();

  let delta_pic_order_always_zero_flag: 0|1 = 0;
  let offset_for_non_ref_pic = 0;
  let offset_for_top_to_bottom_field = 0;

  const offset_for_ref_frame: number[] = [];

  let log2_max_pic_order_cnt_lsb = 0;
  if (pic_order_cnt_type === 0) {
    log2_max_pic_order_cnt_lsb = stream.ExpGolomb() + 4;
  } else if (pic_order_cnt_type === 1) {
    delta_pic_order_always_zero_flag = stream.readBit();
    offset_for_non_ref_pic = stream.SignedExpGolomb();
    offset_for_top_to_bottom_field = stream.SignedExpGolomb();
    const num_ref_frames_in_pic_order_cnt_cycle = stream.ExpGolomb();
    for (let i = 0; i < num_ref_frames_in_pic_order_cnt_cycle; i++) {
      offset_for_ref_frame.push(stream.SignedExpGolomb());
    }
  }

  const max_num_ref_frames = stream.ExpGolomb();
  const gaps_in_frame_num_value_allowed_flag = stream.readBit();
  const pic_width_in_mbs = stream.ExpGolomb() + 1;
  const pic_height_in_map_units = stream.ExpGolomb() + 1;
  const frame_mbs_only_flag = stream.readBit();
  let mb_adaptive_frame_field_flag: 0|1 = 0;
  if (!frame_mbs_only_flag) {
    mb_adaptive_frame_field_flag = stream.readBit();
   }

  const direct_8x8_inference_flag = stream.readBit();
  const frame_cropping_flag = stream.readBit();
  const frame_cropping = getFrameCropping(frame_cropping_flag, stream);

  const vui_parameters_present_flag = stream.readBit();
  const vui_parameters = getVUIParams(vui_parameters_present_flag, stream);

  return {
    sps_id,
    profile_compatibility,
    profile_idc,
    level_idc,
    chroma_format_idc,
    bit_depth_luma,
    bit_depth_chroma,
    color_plane_flag,
    qpprime_y_zero_transform_bypass_flag,
    seq_scaling_matrix_present_flag,
    seq_scaling_matrix: scaling_list_4x4,
    log2_max_frame_num,
    pic_order_cnt_type,
    delta_pic_order_always_zero_flag,
    offset_for_non_ref_pic,
    offset_for_top_to_bottom_field,
    offset_for_ref_frame,
    log2_max_pic_order_cnt_lsb,
    max_num_ref_frames,
    gaps_in_frame_num_value_allowed_flag,
    pic_width_in_mbs,
    pic_height_in_map_units,
    frame_mbs_only_flag,
    mb_adaptive_frame_field_flag,
    direct_8x8_inference_flag,
    frame_cropping_flag,
    frame_cropping,
    vui_parameters_present_flag,
    vui_parameters,
  };
}