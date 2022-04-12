import { Bitstream } from "./bitstream";
import { HRDParams, hrd_parameters } from "./hrd";
import { sps_data, SPSInfo, /*getFrameCropping,*/ FrameCropping } from './sps';

export { FrameCropping };

export type SPS_SVC_EXT = {
  inter_layer_deblocking_filter_control_present_flag: 0|1;
  extended_spatial_scalability_idc: number;
  chroma_phase_x_flag: 0|1;
  chroma_phase_y: number;
  seq_ref_layer_chroma_phase_x_flag: 0|1;
  seq_ref_layer_chroma_phase_y: number;
  seq_scaled_ref_layer_left_offset: number;
  seq_scaled_ref_layer_top_offset: number;
  seq_scaled_ref_layer_right_offset: number;
  seq_scaled_ref_layer_bottom_offset: number;  
  seq_tcoeff_level_prediction_flag: 0|1;
  adaptive_tcoeff_level_prediction_flag: 0|1;
  slice_header_restriction_flag: 0|1;
}

function get_seq_parameter_set_svc_ext(sps: SPSInfo, stream: Bitstream, flag: 1|0): SPS_SVC_EXT {
  const svc: SPS_SVC_EXT = {
    inter_layer_deblocking_filter_control_present_flag: 0,
    extended_spatial_scalability_idc: 0,
    chroma_phase_x_flag: 0,
    chroma_phase_y: 0,
    seq_ref_layer_chroma_phase_x_flag: 0,
    seq_ref_layer_chroma_phase_y: 0,
    seq_scaled_ref_layer_left_offset: 0,
    seq_scaled_ref_layer_top_offset: 0,
    seq_scaled_ref_layer_right_offset: 0,
    seq_scaled_ref_layer_bottom_offset: 0,  
    seq_tcoeff_level_prediction_flag: 0,
    adaptive_tcoeff_level_prediction_flag: 0,
    slice_header_restriction_flag: 0,
  };

  if (!flag) return svc;

  svc.inter_layer_deblocking_filter_control_present_flag = stream.readBit();
  svc.extended_spatial_scalability_idc = (stream.readBit() << 1) | stream.readBit();

  if (sps.chroma_array_type === 1 || sps.chroma_array_type === 2) {
    svc.chroma_phase_x_flag = stream.readBit();
  }
  if (sps.chroma_array_type === 1) {
    svc.chroma_phase_y = ((stream.readBit() << 1) | stream.readBit()) - 1;
  }
  if (svc.extended_spatial_scalability_idc) {
    if (sps.chroma_array_type > 0 ) {
      svc.seq_ref_layer_chroma_phase_x_flag = stream.readBit();
      svc.seq_ref_layer_chroma_phase_y = ((stream.readBit() << 1) | stream.readBit()) - 1;
    }
    svc.seq_scaled_ref_layer_left_offset = stream.SignedExpGolomb();
    svc.seq_scaled_ref_layer_top_offset = stream.SignedExpGolomb();
    svc.seq_scaled_ref_layer_right_offset = stream.SignedExpGolomb();
    svc.seq_scaled_ref_layer_bottom_offset = stream.SignedExpGolomb();
  }

  svc.seq_tcoeff_level_prediction_flag = stream.readBit();

  if (svc.seq_tcoeff_level_prediction_flag) {
    svc.adaptive_tcoeff_level_prediction_flag = stream.readBit();
  }

  svc.slice_header_restriction_flag = stream.readBit();

  return svc;
}

export type SVC_VUI = {
  dependency_id: number;
  quality_id: number;
  temporal_id: number;
  timing_info_present_flag: 0|1;
  num_units_in_tick: number;
  time_scale: number;
  fixed_frame_rate_flag: 0|1;
  nal_hrd_parameters_present_flag: 0|1;
  nal_hrd_parameters: HRDParams;
  vcl_hrd_parameters_present_flag: 0|1;
  vcl_hrd_parameters: HRDParams;
  low_delay_hrd_flag: 0|1;
  pic_struct_present_flag: 0|1;
}

function get_svc_vui_parameters_ext(stream: Bitstream, flag: 0|1): SVC_VUI[] {
  if (!flag) return [];

  const num_entries_minus_1 = stream.ExpGolomb();
  const entries: SVC_VUI[] = [];
  for (let i = 0; i <= num_entries_minus_1; i++) {
    const svc: SVC_VUI = {
      dependency_id: 0,
      quality_id: 0,
      temporal_id: 0,
      timing_info_present_flag: 0,
      num_units_in_tick: 0,
      time_scale: 0,
      fixed_frame_rate_flag: 0,
      nal_hrd_parameters_present_flag: 0,
      nal_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      vcl_hrd_parameters_present_flag: 0,
      vcl_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      low_delay_hrd_flag: 0,
      pic_struct_present_flag: 0,
    };

    svc.dependency_id = stream.readN(3);
    svc.quality_id = stream.readN(4);
    svc.temporal_id = stream.readN(3);
    svc.timing_info_present_flag = stream.readBit();
    if (svc.timing_info_present_flag) {
      svc.num_units_in_tick = stream.readWord();
      svc.time_scale = stream.readWord();
      svc.fixed_frame_rate_flag = stream.readBit();
    }
    
    svc.nal_hrd_parameters_present_flag = stream.readBit();
    if (svc.nal_hrd_parameters_present_flag) {
      hrd_parameters(svc.nal_hrd_parameters, stream);
    }
    
    svc.vcl_hrd_parameters_present_flag = stream.readBit();
    if (svc.vcl_hrd_parameters_present_flag) {
      hrd_parameters(svc.vcl_hrd_parameters, stream);
    }

    if (svc.nal_hrd_parameters_present_flag ||
        svc.vcl_hrd_parameters_present_flag) {
      svc.low_delay_hrd_flag = stream.readBit();
    }

    svc.pic_struct_present_flag = stream.readBit();

    entries.push(svc);
  }

  return entries;
}

export type MVC_VUI = {
  temporal_id: number;
  view_id: number[];
  timing_info_present_flag: 0|1;
  num_units_in_tick: number;
  time_scale: number;
  fixed_frame_rate_flag: 0|1;
  nal_hrd_parameters_present_flag: 0|1;
  nal_hrd_parameters: HRDParams;
  vcl_hrd_parameters_present_flag: 0|1;
  vcl_hrd_parameters: HRDParams;
  low_delay_hrd_flag: 0|1;
  pic_struct_present_flag: 0|1;
}

function get_mvc_vui_parameters_ext(stream: Bitstream, flag: 0|1): MVC_VUI[] {
  if (!flag) return [];

  const num_ops_minus_1 = stream.ExpGolomb();
  const ops: MVC_VUI[] = [];
  for (let i = 0; i <= num_ops_minus_1; i++) {
    const mvc: MVC_VUI = {
      temporal_id: 0,
      view_id: [],    
      timing_info_present_flag: 0,
      num_units_in_tick: 0,
      time_scale: 0,
      fixed_frame_rate_flag: 0,
      nal_hrd_parameters_present_flag: 0,
      nal_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      vcl_hrd_parameters_present_flag: 0,
      vcl_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      low_delay_hrd_flag: 0,
      pic_struct_present_flag: 0,
    };

    mvc.temporal_id = stream.readN(3);

    const num_target_views_minus1 = stream.ExpGolomb();
    for (let j = 0; j <= num_target_views_minus1; j++) {
      mvc.view_id[j] = stream.ExpGolomb();
    }

    mvc.timing_info_present_flag = stream.readBit();
    if (mvc.timing_info_present_flag) {
      mvc.num_units_in_tick = stream.readWord();
      mvc.time_scale = stream.readWord();
      mvc.fixed_frame_rate_flag = stream.readBit();
    }
    
    mvc.nal_hrd_parameters_present_flag = stream.readBit();
    if (mvc.nal_hrd_parameters_present_flag) {
      hrd_parameters(mvc.nal_hrd_parameters, stream);
    }
    
    mvc.vcl_hrd_parameters_present_flag = stream.readBit();
    if (mvc.vcl_hrd_parameters_present_flag) {
      hrd_parameters(mvc.vcl_hrd_parameters, stream);
    }

    if (mvc.nal_hrd_parameters_present_flag ||
        mvc.vcl_hrd_parameters_present_flag) {
      mvc.low_delay_hrd_flag = stream.readBit();
    }

    mvc.pic_struct_present_flag = stream.readBit();

    ops.push(mvc);
  }

  return ops;
}

export type MVCView = {
  view_id: number;
  anchor_ref_l0: number[];
  anchor_ref_l1: number[];
  non_anchor_ref_l0: number[];
  non_anchor_ref_l1: number[];
};

export type MVCLevel = {
  level_idc: number;
  applicable_op_temporal_id: number[];
  applicable_op_num_target_views: number[];
  applicable_op_target_view_id: number[][];
  applicable_op_num_views: number[];
};

export type MVC_EXT = {
  views: MVCView[];
  levels: MVCLevel[];
  mfc_format_idc: number;
  default_grid_position_flag: 0|1;
  view0_grid_position_x: number;
  view0_grid_position_y: number;
  view1_grid_position_x: number;
  view1_grid_position_y: number;
  rpu_filter_enabled_flag: 0|1;
  rpu_field_processing_flag: 0|1;
}

function get_seq_parameter_set_mvc_ext(sps: SPSInfo, stream: Bitstream, flag: 0|1): MVC_EXT {
  const mvc: MVC_EXT = {
    views: [],
    levels: [],
    mfc_format_idc: 0,
    default_grid_position_flag: 0,
    view0_grid_position_x: 0,
    view0_grid_position_y: 0,
    view1_grid_position_x: 0,
    view1_grid_position_y: 0,
    rpu_filter_enabled_flag: 0,
    rpu_field_processing_flag: 0,
  };
  
  if (!flag) return mvc;
  
  const num_views = stream.ExpGolomb() + 1;
  const views: MVCView[] = Array.from({ length: num_views }, () => ({
    view_id: 0,
    anchor_ref_l0: [],
    anchor_ref_l1: [],
    non_anchor_ref_l0: [],
    non_anchor_ref_l1: [],
  }));
  for (let i = 0; i < num_views; i++) {
    views[i].view_id = stream.ExpGolomb();
  }
  for (let i = 0; i < num_views; i++) {
    const { anchor_ref_l0, anchor_ref_l1 } = views[i];
    const num_anchor_refs_l0 = stream.ExpGolomb();
    for (let j = 0; j < num_anchor_refs_l0; j++) {
      anchor_ref_l0[j] = stream.ExpGolomb();
    }
    const num_anchor_refs_l1 = stream.ExpGolomb();
    for (let j = 0; j < num_anchor_refs_l1; j++) {
      anchor_ref_l1[j] = stream.ExpGolomb();
    }
  }
  for (let i = 0; i < num_views; i++) {
    const { non_anchor_ref_l0, non_anchor_ref_l1 } = views[i];
    const num_non_anchor_refs_l0 = stream.ExpGolomb();
    for (let j = 0; j < num_non_anchor_refs_l0; j++) {
      non_anchor_ref_l0[j] = stream.ExpGolomb();
    }
    const num_non_anchor_refs_l1 = stream.ExpGolomb();
    for (let j = 0; j < num_non_anchor_refs_l1; j++) {
      non_anchor_ref_l1[j] = stream.ExpGolomb();
    }
  }

  const num_levels = stream.ExpGolomb() + 1;
  const levels: MVCLevel[] = [];
  for (let i = 0; i < num_levels; i++) {
    const level_idc = stream.readByte();
    const num_ops = stream.ExpGolomb() + 1;
    const applicable_op_temporal_id: number[] = [];
    const applicable_op_num_target_views: number[] = [];
    const applicable_op_target_view_id: number[][] = [];
    const applicable_op_num_views: number[] = [];
    for (let j = 0; j < num_ops; j++) {
      applicable_op_temporal_id[j] = stream.readN(3);
      const num_targets = stream.ExpGolomb() + 1;
      applicable_op_num_target_views[j] = num_targets;
      const view_id: number[] = [];
      applicable_op_target_view_id[j] = view_id;
      for (let k = 0; k < num_targets; k++) {
        view_id[k] = stream.ExpGolomb();
      }
      applicable_op_num_views[j] = stream.ExpGolomb();
    }
    levels[i] = {
      level_idc,
      applicable_op_temporal_id,
      applicable_op_num_target_views,
      applicable_op_target_view_id: [],
      applicable_op_num_views: [],
    };
  }

  mvc.views = views;
  mvc.levels = levels;

  if (sps.profile_idc === 134) {
    mvc.mfc_format_idc = stream.readN(6);
    if (mvc.mfc_format_idc === 0 || mvc.mfc_format_idc === 1) {
      mvc.default_grid_position_flag = stream.readBit();
      if (!mvc.default_grid_position_flag) {
        mvc.view0_grid_position_x = stream.readN(4);
        mvc.view0_grid_position_y = stream.readN(4);
        mvc.view1_grid_position_x = stream.readN(4);
        mvc.view1_grid_position_y = stream.readN(4);
      }
    }
  }

  mvc.rpu_filter_enabled_flag = stream.readBit();

  if (!sps.frame_mbs_only_flag) {
    mvc.rpu_field_processing_flag = stream.readBit();
  }

  return mvc;
}

export type MVCD_VUI = {
  temporal_id: number;
  view_id: number[];
  depth_flag: (0|1)[];
  texture_flag: (0|1)[];
  timing_info_present_flag: 0|1;
  num_units_in_tick: number;
  time_scale: number;
  fixed_frame_rate_flag: 0|1;
  nal_hrd_parameters_present_flag: 0|1,
  nal_hrd_parameters: HRDParams;
  vcl_hrd_parameters_present_flag: 0|1;
  vcl_hrd_parameters: HRDParams;
  low_delay_hrd_flag: 0|1;
  pic_struct_present_flag: 0|1;
};

function get_mvcd_vui_parameters_ext(stream: Bitstream): MVCD_VUI[] {
  const ops: MVCD_VUI[] = [];
  const num_ops_minus1 = stream.ExpGolomb();
  for (let i = 0; i <= num_ops_minus1; i++) {
    const temporal_id = stream.readN(3);
    const num_targets_minus1 = stream.ExpGolomb();
    const op: MVCD_VUI = {
      temporal_id,
      view_id: [],
      depth_flag: [],
      texture_flag: [],
      timing_info_present_flag: 0,
      num_units_in_tick: 0,
      time_scale: 0,
      fixed_frame_rate_flag: 0,
      nal_hrd_parameters_present_flag: 0,
      nal_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      vcl_hrd_parameters_present_flag: 0,
      vcl_hrd_parameters: {
        cpb_cnt: 0,
        bit_rate_scale: 0,
        cpb_size_scale: 0,
        bit_rate_value: [],
        cpb_size_value: [],
        cbr_flag: [],
        initial_cpb_removal_delay_length: 0,
        cpb_removal_delay_length: 0,
        dpb_output_delay_length: 0,
        time_offset_length: 0,
      },
      low_delay_hrd_flag: 0,
      pic_struct_present_flag: 0,
    };

    for (let j = 0; j <= num_targets_minus1; j++) {
      op.view_id[j] = stream.ExpGolomb();
      op.depth_flag[j] = stream.readBit();
      op.texture_flag[j] = stream.readBit();
    }

    op.timing_info_present_flag = stream.readBit();
    if (op.timing_info_present_flag) {
      op.num_units_in_tick = stream.readWord();
      op.time_scale = stream.readWord();
      op.fixed_frame_rate_flag = stream.readBit();
    }

    op.nal_hrd_parameters_present_flag = stream.readBit();
    if (op.nal_hrd_parameters_present_flag) {
      hrd_parameters(op.nal_hrd_parameters, stream);
    }
  
    op.vcl_hrd_parameters_present_flag = stream.readBit();
    if (op.vcl_hrd_parameters_present_flag) {
      hrd_parameters(op.vcl_hrd_parameters, stream);
    }

    if (op.nal_hrd_parameters_present_flag ||
        op.vcl_hrd_parameters_present_flag) {
      op.low_delay_hrd_flag = stream.readBit();
    }

    op.pic_struct_present_flag = stream.readBit();
  }

  return ops;
}

export type MVCDView = {
  view_id: number;
  depth_view_present_flag: 0|1;
  texture_view_present_flag: 0|1;
  anchor_ref_l0: number[];
  anchor_ref_l1: number[];
  non_anchor_ref_l0: number[];
  non_anchor_ref_l1: number[];
};

export type MVCDLevel = {
  level_idc: number;
  applicable_op_temporal_id: number[];
  applicable_op_target_view_id: number[][];
  applicable_op_depth_flag: (0|1)[][];
  applicable_op_texture_flag: (0|1)[][];
  applicable_op_num_texture_views: number[];
  applicable_op_num_depth_views: number[];
};

export type MVCD_EXT = {
  num_views: number;
  views: MVCDView[];
  num_depth_views: number;
  depth_view_id: number[];
  levels: MVCDLevel[];
  mvcd_vui_parameters_present_flag: 0|1;
  mvcd_vui_parameters: MVCD_VUI[];
  texture_vui_parameters_present_flag: 0|1;
  texture_vui_parameters: MVC_VUI[];
};

function get_seq_parameter_set_mvcd_ext(stream: Bitstream, flag: 0|1): MVCD_EXT {
  const mvcd: MVCD_EXT = {
    num_views: 0,
    views: [],
    num_depth_views: 0,
    depth_view_id: [],
    levels: [],
    mvcd_vui_parameters_present_flag: 0,
    mvcd_vui_parameters: [],
    texture_vui_parameters_present_flag: 0,
    texture_vui_parameters: [],
  };

  if (!flag) return mvcd;

  const num_views_minus1 = stream.ExpGolomb();
  let ndv = 0;
  for (let i = 0; i <= num_views_minus1; i++) {
    const view_id = stream.ExpGolomb();
    const depth_view_present_flag = stream.readBit();
    mvcd.depth_view_id[ndv] = view_id;
    ndv += depth_view_present_flag;
    const texture_view_present_flag = stream.readBit();
    mvcd.views[i] = {
      view_id,
      depth_view_present_flag,
      texture_view_present_flag,
      anchor_ref_l0: [],
      anchor_ref_l1: [],
      non_anchor_ref_l0: [],
      non_anchor_ref_l1: [],
    };
  }

  mvcd.num_views = num_views_minus1 + 1;
  mvcd.num_depth_views = ndv;

  for (let i = 1; i <= num_views_minus1; i++) {
    const view = mvcd.views[i];
    if (!view.depth_view_present_flag) { continue; }
    const num_anchor_refs_l0 = stream.ExpGolomb();
    for (let j = 0; j < num_anchor_refs_l0; j++) {
      view.anchor_ref_l0[j] = stream.ExpGolomb();
    }
    const num_anchor_refs_l1 = stream.ExpGolomb();
    for (let j = 0; j < num_anchor_refs_l1; j++) {
      view.anchor_ref_l1[j] = stream.ExpGolomb();
    }
  }

  for (let i = 1; i <= num_views_minus1; i++) {
    const view = mvcd.views[i];
    if (!view.depth_view_present_flag) { continue; }
    const num_non_anchor_refs_l0 = stream.ExpGolomb();
    for (let j = 0; j < num_non_anchor_refs_l0; j++) {
      view.non_anchor_ref_l0[j] = stream.ExpGolomb();
    }
    const num_non_anchor_refs_l1 = stream.ExpGolomb();
    for (let j = 0; j < num_non_anchor_refs_l1; j++) {
      view.non_anchor_ref_l1[j] = stream.ExpGolomb();
    }
  }

  const num_levels = stream.ExpGolomb();
  for (let i = 0; i < num_levels; i++) {
    const level_idc = stream.readByte();
    const num_ops_minus1 = stream.ExpGolomb();
    const level: MVCDLevel = {
      level_idc,
      applicable_op_temporal_id: [],
      applicable_op_num_texture_views: [],
      applicable_op_num_depth_views: [],
      applicable_op_target_view_id: [],
      applicable_op_depth_flag: [],
      applicable_op_texture_flag: [],
    };

    for (let j = 0; j <= num_ops_minus1; j++) {
      level.applicable_op_temporal_id[j] = stream.readN(3);
      const target_view_id: number[] = [];
      level.applicable_op_target_view_id[j] = target_view_id;
      const depth_flag: (0|1)[] = [];
      level.applicable_op_depth_flag[j] = depth_flag;
      const texture_flag: (0|1)[] = [];
      level.applicable_op_texture_flag[j] = texture_flag;
      const num_target_views_minus1 = stream.ExpGolomb();
      for (let k = 0; k <= num_target_views_minus1; k++) {
        target_view_id[k] = stream.ExpGolomb();
        depth_flag[k] = stream.readBit();
        texture_flag[k] = stream.readBit();
      }
      level.applicable_op_num_texture_views[j] = stream.ExpGolomb() + 1;
      level.applicable_op_num_depth_views[j] = stream.ExpGolomb();
    }
  }

  mvcd.mvcd_vui_parameters_present_flag = stream.readBit();
  if (mvcd.mvcd_vui_parameters_present_flag) {
    mvcd.mvcd_vui_parameters =
      get_mvcd_vui_parameters_ext(stream);
  }
  mvcd.texture_vui_parameters_present_flag = stream.readBit();
  if (mvcd.texture_vui_parameters_present_flag) {
    mvcd.texture_vui_parameters =
      get_mvc_vui_parameters_ext(stream, 1);
  }

  return mvcd;
}

export type ThreeDAVC = {
  view_id_3dv: number[];
  threedv_acquisition_idc: number;
  depth_pic_width_in_mbs: number;
  depth_pic_height_in_map_units: number;
  depth_hor_mult: number;
  depth_ver_mult: number;
  depth_hor_rsh: number;
  depth_ver_rsh: number;
  depth_frame_cropping_flag: 0|1;
  depth_frame_crop: FrameCropping;
  grid_pos_num_view: number;
  grid_pos_view_id: number[];
  grid_pos_x: number[];
  grid_pos_y: number[];
  slice_header_prediction_flag: 0|1;
  seq_view_synthesis_flag: 0|1;
  alc_sps_enable_flag: 0|1;
  enable_rle_skip_flag: 0|1;
  anchor_ref_l0: number[][];
  anchor_ref_l1: number[][];
  non_anchor_ref_l0: number[][];
  non_anchor_ref_l1: number[][];
};
/*
function depth_ranges(stream: Bitstream, num_views: number, pred_dir: number, index: number) {
  const z_near_flag = stream.readBit();
  const z_far_flag = stream.readBit();
  if (z_near_flag) {
    const [ZNearSign, ZNearExp, ZNearMantissa, ZNearManLen] = 
      tdv_acquisition_element(num_views, 0, pred_dir, 7, 0);
  }
  if (z_far_flag) {
    const [ZFarSign, ZFarExp, ZFarMantissa, ZFarManLen] = 
      tdv_acquisition_element(num_views, 0, pred_dir, 7, 0);
  }
}
*/
function get_seq_parameter_set_3davc_ext(_stream: Bitstream, _flag: 0|1, _mvcd: MVCD_EXT): ThreeDAVC {
  const avc: ThreeDAVC = {
    view_id_3dv: [],
    threedv_acquisition_idc: 0,
    depth_pic_width_in_mbs: 0,
    depth_pic_height_in_map_units: 0,
    depth_hor_mult: 0,
    depth_ver_mult: 0,
    depth_hor_rsh: 0,
    depth_ver_rsh: 0,
    depth_frame_cropping_flag: 0,
    depth_frame_crop: { left: 0, right: 0, top: 0, bottom: 0 },
    grid_pos_num_view: 0,
    grid_pos_view_id: [],
    grid_pos_x: [],
    grid_pos_y: [],
    slice_header_prediction_flag: 0,
    seq_view_synthesis_flag: 0,
    alc_sps_enable_flag: 0,
    enable_rle_skip_flag: 0,
    anchor_ref_l0: [],
    anchor_ref_l1: [],
    non_anchor_ref_l0: [],
    non_anchor_ref_l1: [],
  };
/*
  if (!flag) return avc;

  const { num_views, num_depth_views, views } = mvcd;
  if (num_depth_views > 0) {
    avc.threedv_acquisition_idc = stream.ExpGolomb();
    for (let i = 0; i < num_depth_views; i++) {
      avc.view_id_3dv[i] = stream.ExpGolomb();
    }
    if(avc.threedv_acquisition_idc) {
      depth_ranges(num_depth_views, 2, 0);
      vsp_param(num_depth_views, 2, 0);
    }

    const reduced_resolution_flag: 0|1 = stream.readBit();
    if (reduced_resolution_flag) {
      avc.depth_pic_width_in_mbs = stream.ExpGolomb() + 1;
      avc.depth_pic_height_in_map_units = stream.ExpGolomb() + 1;
      avc.depth_hor_mult = stream.ExpGolomb() + 1;
      avc.depth_ver_mult = stream.ExpGolomb() + 1;
      avc.depth_hor_rsh = stream.ExpGolomb();
      avc.depth_ver_rsh = stream.ExpGolomb();
    }

    avc.depth_frame_cropping_flag = stream.readBit();
    avc.depth_frame_crop = getFrameCropping(avc.depth_frame_cropping_flag, stream);

    const grid_pos_num_views = stream.ExpGolomb();
    avc.grid_pos_num_view = grid_pos_num_views;
    for (let i = 0; i < grid_pos_num_views; i++) {
      avc.grid_pos_view_id[i] = stream.ExpGolomb();
      avc.grid_pos_x[avc.grid_pos_view_id[i]] = stream.SignedExpGolomb();
      avc.grid_pos_y[avc.grid_pos_view_id[i]] = stream.SignedExpGolomb();
    }

    avc.slice_header_prediction_flag = stream.readBit();
    avc.seq_view_synthesis_flag = stream.readBit();
  }

  avc.alc_sps_enable_flag = stream.readBit();
  avc.enable_rle_skip_flag = stream.readBit();
  
  let AllViewsPairedFlag = 1;
  for (let i = 1; i < num_views; i++) {
    const v = views[i];
    if (!(v.depth_view_present_flag && v.texture_view_present_flag)) {
      AllViewsPairedFlag = 0;
      break;
    }
  }

  if (AllViewsPairedFlag) { return avc; }

  for (let i = 1; i < num_views; i++) {
    if (views[i].texture_view_present_flag) {
      const num_anchor_refs_l0 = stream.ExpGolomb();
      const anchor_ref_l0: number[] = [];
      avc.anchor_ref_l0[i] = anchor_ref_l0;
      for(let j = 0; j < num_anchor_refs_l0; j++) {
        anchor_ref_l0[j] = stream.ExpGolomb();
      }
      const num_anchor_refs_l1 = stream.ExpGolomb();
      const anchor_ref_l1: number[] = [];
      avc.anchor_ref_l1[i] = anchor_ref_l1;
      for(let j = 0; j < num_anchor_refs_l1; j++) {
        anchor_ref_l1[j] = stream.ExpGolomb();
      }
    } else {
      avc.anchor_ref_l0[i] = views[i].anchor_ref_l0;
      avc.anchor_ref_l1[i] = views[i].anchor_ref_l1;
    }
  }
  for (let i = 1; i < num_views; i++) {
    if (views[i].texture_view_present_flag) {
      const num_non_anchor_refs_l0 = stream.ExpGolomb();
      const non_anchor_ref_l0: number[] = [];
      for(let j = 0; j < num_non_anchor_refs_l0; j++) {
        non_anchor_ref_l0[j] = stream.ExpGolomb();
      }
      const num_non_anchor_refs_l1 = stream.ExpGolomb();
      const non_anchor_ref_l1: number[] = [];
      for(let j = 0; j < num_non_anchor_refs_l1; j++) {
        non_anchor_ref_l1[j] = stream.ExpGolomb();
      }
    } else {
      avc.non_anchor_ref_l0[i] = views[i].non_anchor_ref_l0;
      avc.non_anchor_ref_l1[i] = views[i].non_anchor_ref_l1;
    }
  }
*/
  return avc;
}

export type SSPSInfo = {
  nalu_type: 15;
  sps_data: SPSInfo;
  svc_vui_parameters_present_flag: 0|1;
  mvc_vui_parameters_present_flag: 0|1;
  seq_parameter_set_svc_ext: SPS_SVC_EXT;
  svc_vui_parameters_ext: SVC_VUI[];
  seq_parameter_set_mvc_ext: MVC_EXT;
  mvc_vui_parameters_ext: MVC_VUI[];
  seq_parameter_set_mvcd_ext: MVCD_EXT;
  seq_parameter_set_3davc_ext: ThreeDAVC;
};

export function parseSSPS(nalu: Uint8Array): SSPSInfo {
  if ((nalu[0] & 0x1F) !== 15) throw new Error("Not an SPS unit");
 
  const stream = new Bitstream(new DataView(nalu.buffer, nalu.byteOffset + 4));

  const sps = sps_data(nalu, stream);

  const ssps: SSPSInfo = {} as any;

  ssps.svc_vui_parameters_present_flag = 0;
  ssps.mvc_vui_parameters_present_flag = 0;

  switch(sps.profile_idc) {
    case 83:
    case 86: {
      ssps.seq_parameter_set_svc_ext = 
        get_seq_parameter_set_svc_ext(sps, stream, 1);
      ssps.svc_vui_parameters_present_flag = stream.readBit();
      ssps.svc_vui_parameters_ext =
        get_svc_vui_parameters_ext(stream, ssps.svc_vui_parameters_present_flag);
      
      ssps.seq_parameter_set_mvc_ext =
        get_seq_parameter_set_mvc_ext(sps, stream, 0);
      ssps.mvc_vui_parameters_ext =
        get_mvc_vui_parameters_ext(stream, 0);      
      ssps.seq_parameter_set_mvcd_ext =
        get_seq_parameter_set_mvcd_ext(stream, 0);  
      ssps.seq_parameter_set_3davc_ext = 
        get_seq_parameter_set_3davc_ext(
          stream, 0,
          ssps.seq_parameter_set_mvcd_ext,
        );
      break;
    }
    case 118:
    case 128:
    case 134: {
      stream.bitoffset++; // bit_equal_to_one
      ssps.seq_parameter_set_mvc_ext =
        get_seq_parameter_set_mvc_ext(sps, stream, 1);
      ssps.mvc_vui_parameters_present_flag = stream.readBit();
      ssps.mvc_vui_parameters_ext =
        get_mvc_vui_parameters_ext(stream, ssps.mvc_vui_parameters_present_flag);
      
      ssps.seq_parameter_set_svc_ext = 
        get_seq_parameter_set_svc_ext(sps, stream, 0);
      ssps.svc_vui_parameters_ext =
        get_svc_vui_parameters_ext(stream, 0);    
      ssps.seq_parameter_set_mvcd_ext =
        get_seq_parameter_set_mvcd_ext(stream, 0);  
      ssps.seq_parameter_set_3davc_ext = 
        get_seq_parameter_set_3davc_ext(
          stream, 0,
          ssps.seq_parameter_set_mvcd_ext,
        );
      break;
    }
    case 138:
    case 135: {
      stream.bitoffset++; // bit_equal_to_one
      ssps.seq_parameter_set_mvcd_ext =
        get_seq_parameter_set_mvcd_ext(stream, 1);
      
      ssps.seq_parameter_set_mvc_ext =
        get_seq_parameter_set_mvc_ext(sps, stream, 0);
      ssps.mvc_vui_parameters_ext =
        get_mvc_vui_parameters_ext(stream, 0);
      ssps.seq_parameter_set_svc_ext = 
        get_seq_parameter_set_svc_ext(sps, stream, 0);
      ssps.svc_vui_parameters_ext =
        get_svc_vui_parameters_ext(stream, 0);
      ssps.seq_parameter_set_3davc_ext = 
        get_seq_parameter_set_3davc_ext(
          stream, 0,
          ssps.seq_parameter_set_mvcd_ext,
        );
      break;
    }
    case 139: {
      stream.bitoffset++; // bit_equal_to_one
      ssps.seq_parameter_set_mvcd_ext =
        get_seq_parameter_set_mvcd_ext(stream, 1);
      ssps.seq_parameter_set_3davc_ext = 
        get_seq_parameter_set_3davc_ext(
          stream, 1,
          ssps.seq_parameter_set_mvcd_ext,
        );
            
      ssps.seq_parameter_set_mvc_ext =
        get_seq_parameter_set_mvc_ext(sps, stream, 0);
      ssps.mvc_vui_parameters_ext =
        get_mvc_vui_parameters_ext(stream, 0);
      ssps.seq_parameter_set_svc_ext = 
        get_seq_parameter_set_svc_ext(sps, stream, 0);
      ssps.svc_vui_parameters_ext =
        get_svc_vui_parameters_ext(stream, 0);
      break;
    }
  }

  return ssps;
}