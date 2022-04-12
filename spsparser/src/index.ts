import { Bitstream } from "./bitstream";
import { SPSInfo, FrameCropping, VUIParams, parseSPS } from "./sps";

export { SPSInfo, FrameCropping, VUIParams, Bitstream, parseSPS };

export function parse(nalu: Uint8Array): SPSInfo {
  switch (nalu[0] & 0x1F) {
    case 7: return parseSPS(nalu);
    case 13: return parseSPSE(nalu);
    case 15: return parseSSPS(nalu);
    default: throw new Error("Not an SPS unit");
}