import { Bitstream, SPSInfo } from 'h264-sps-parser';

export { SPSInfo };

export type PPSInfo = {
  pps_id: number;
  sps_id: number;
  entropy_coding_mode_flag: 0|1;
  bottom_field_pic_order_in_frame_present_flag: 0|1;
  num_slice_groups: number;
  slice_group_map_type: number;
  run_length: number[];
  top_left: number[];
  bottom_right: number[];
  slice_group_change_direction_flag: 0|1;
  slice_group_change_rate: number;
  pic_size_in_map_units: number;
  slice_group_id: number[];
  num_refs_idx_10_default_active: number;
  num_refs_idx_11_default_active: number;
  weighted_pred_flag: 0|1;
  weighted_bipred_idc: number;
  pic_init_qp: number;
  pic_init_qs: number;
  chroma_qp_index_offset: number;
  deblocking_filter_control_present_flag: number;
  constrained_intra_pred_flag: 0|1;
  redundant_pic_cnt_present_flag: 0|1;
  transform_8x8_mode_flag: 0|1;
  pic_scaling_matrix_present_flag: 0|1;
  pic_scaling_list_present_flag: (0|1)[];
  scaling_list_4x4: number[][];
  scaling_list_8x8: number[][];
  use_default_scaling_matrix_4x4_flag: (0|1)[];
  use_default_scaling_matrix_8x8_flag: (0|1)[];
  second_chroma_qp_index_offset: number;
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

export function parse(nalu: Uint8Array, spss: Map<number, SPSInfo>): PPSInfo {
  if ((nalu[0] & 0x1F) !== 8) throw new Error("Not a PPS unit");
 
  const stream = new Bitstream(new DataView(nalu.buffer, nalu.byteOffset + 1));

  const pps_id = stream.ExpGolomb();
  const sps_id = stream.ExpGolomb();
  const entropy_coding_mode_flag: 0|1 = stream.readBit();
  const bottom_field_pic_order_in_frame_present_flag: 0|1 = stream.readBit();
  const num_slice_groups = stream.ExpGolomb() + 1;

  let slice_group_map_type = 0;
  let slice_group_change_direction_flag: 0|1 = 0;
  let slice_group_change_rate = 0;
  let pic_size_in_map_units = 0;

  const run_length: number[] = [];
  const top_left: number[] = [];
  const bottom_right: number[] = [];
  const slice_group_id: number[] = [];

  if (num_slice_groups > 1) {
    slice_group_map_type = stream.ExpGolomb();
    switch (slice_group_map_type) {
      case 0: {
        for (let i = 0; i < num_slice_groups; i++) {
          run_length[i] = stream.ExpGolomb() + 1;
        }
        break;
      }
      case 2: {
        for (let i = 0; i < num_slice_groups; i++) {
          top_left[i] = stream.ExpGolomb();
          bottom_right[i] = stream.ExpGolomb();
        }
        break;
      }
      case 3:
      case 4:
      case 5: {
        slice_group_change_direction_flag = stream.readBit();
        slice_group_change_rate = stream.ExpGolomb() + 1;
        break;
      }
      case 6: {
        const v = Math.ceil(Math.log2(num_slice_groups));
        pic_size_in_map_units = stream.ExpGolomb() + 1;
        for (let i = 0; i < pic_size_in_map_units; i++) {
          slice_group_id[i] = stream.readV(v);
        }
      }
    }
  }

  const num_refs_idx_10_default_active = stream.ExpGolomb();
  const num_refs_idx_11_default_active = stream.ExpGolomb();
  const weighted_pred_flag: 0|1 = stream.readBit();
  const weighted_bipred_idc = (stream.readBit() << 1) | stream.readBit();
  const pic_init_qp = stream.SignedExpGolomb() + 26;
  const pic_init_qs = stream.SignedExpGolomb() + 26;
  const chroma_qp_index_offset = stream.SignedExpGolomb();
  const deblocking_filter_control_present_flag: 0|1 = stream.readBit();
  const constrained_intra_pred_flag: 0|1 = stream.readBit();
  const redundant_pic_cnt_present_flag: 0|1 = stream.readBit();
  
  let transform_8x8_mode_flag: 0|1 = 0;
  let pic_scaling_matrix_present_flag: 0|1 = 0;
  let second_chroma_qp_index_offset = 0;

  const pic_scaling_list_present_flag: (0|1)[] = [];
  const scaling_list_4x4: number[][] = [];
  const scaling_list_8x8: number[][] = [];
  const use_default_scaling_matrix_4x4_flag: (0|1)[] = [];
  const use_default_scaling_matrix_8x8_flag: (0|1)[] = [];

  if (stream.more_rbsp_data()) {
    transform_8x8_mode_flag = stream.readBit();
    pic_scaling_matrix_present_flag = stream.readBit();
    if (pic_scaling_matrix_present_flag) {
      for (let i = 0; i < 6; i++) {
        const f: 0|1 = stream.readBit();
        pic_scaling_list_present_flag[i] = f;
        if (f) {
          scaling_list_4x4.push(
            scaling_list(
              stream, 16,
              use_default_scaling_matrix_4x4_flag, i,
            )
          );
        }
      }
      
      if (transform_8x8_mode_flag) {
        const { chroma_format_idc } = spss.get(sps_id) as SPSInfo;
        const limit = chroma_format_idc === 3 ? 6 : 2;
      
        for (let i = 0; i < limit; i++) {
          const f: 0|1 = stream.readBit();
          pic_scaling_list_present_flag[i + 6] = f;
          if (f) {
            scaling_list_8x8.push(
              scaling_list(
                stream, 64,
                use_default_scaling_matrix_8x8_flag, i,
              )
            );
          }
        }
      }
    }

    second_chroma_qp_index_offset = stream.SignedExpGolomb();
  }

  return {
    pps_id, sps_id,
    entropy_coding_mode_flag,
    bottom_field_pic_order_in_frame_present_flag,
    num_slice_groups,
    slice_group_map_type,
    run_length,
    top_left,
    bottom_right,
    slice_group_change_direction_flag,
    slice_group_change_rate,
    pic_size_in_map_units,
    slice_group_id,
    num_refs_idx_10_default_active,
    num_refs_idx_11_default_active,
    weighted_pred_flag,
    weighted_bipred_idc,
    pic_init_qp,
    pic_init_qs,
    chroma_qp_index_offset,
    deblocking_filter_control_present_flag,
    constrained_intra_pred_flag,
    redundant_pic_cnt_present_flag,
    transform_8x8_mode_flag,
    pic_scaling_matrix_present_flag,
    pic_scaling_list_present_flag,
    scaling_list_4x4,
    scaling_list_8x8,
    use_default_scaling_matrix_4x4_flag,
    use_default_scaling_matrix_8x8_flag,
    second_chroma_qp_index_offset,
  };
}