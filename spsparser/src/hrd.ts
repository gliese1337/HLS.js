import { Bitstream } from "./bitstream";

export type HRDParams = {
  cpb_cnt: number;
  bit_rate_scale: number;
  cpb_size_scale: number;
  bit_rate_value: number[];
  cpb_size_value: number[];
  cbr_flag: (0|1)[];
  initial_cpb_removal_delay_length: number;
  cpb_removal_delay_length: number;
  dpb_output_delay_length: number;
  time_offset_length: number;
};

export function hrd_parameters(hrd: HRDParams, stream: Bitstream): void {
  const cpb_cnt_minus1 = stream.ExpGolomb();
  hrd.cpb_cnt = cpb_cnt_minus1 + 1;
  hrd.bit_rate_scale = stream.readNibble();
  hrd.cpb_size_scale = stream.readNibble();
  for (let i = 0; i <= cpb_cnt_minus1; i++) {
    hrd.bit_rate_value[i] = stream.ExpGolomb() + 1;
    hrd.cpb_size_value[i] = stream.ExpGolomb() + 1;
    hrd.cbr_flag[i] = stream.readBit();
  }
  hrd.initial_cpb_removal_delay_length = stream.read5() + 1;
  hrd.cpb_removal_delay_length = stream.read5() + 1;
  hrd.dpb_output_delay_length = stream.read5() + 1;
  hrd.time_offset_length = stream.read5();
}
