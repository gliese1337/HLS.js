
export const PACKET_LEN = 188;

export const SYNC_BYTE = 0x47;

export const ErrCodes = [
  "",
  "Error 1: Incomplete TS Packet",
  "Error 2: Invalid Sync Byte",
  "Error 3: Transport Error",
  "Error 4: Packet Scrambled",
  "Error 5: Adaptation Field Overflows File Length",
  "Error 6: Incomplete PES Packet (Possibly PAT)",
  "Error 7: Incomplete PAT",
  "Error 8: Invalid PAT Header",
  "Error 9: PAT Overflows File Length",
  "Error 10: PAT Body Isn't a Multiple of the Entry Size (32 bits)",
  "Error 11: Invalid PAT Entry",
  "Error 12: Incomplete PES Packet (Possibly PMT)",
  "Error 13: Incomplete PMT",
  "Error 14: Invalid PMT Header",
  "Error 15: PMT Length Too Large",
  "Error 16: PMT Doesn't Start at Beginning of TS Packet Payload",
  "Error 17: Program Info Oveflows PMT Length",
  "Error 18: Incomplete Elementary Stream Info",
  "Error 19: Invalid Elementary Stream Header",
  "Error 20: Elementary Stream Data Overflows PMT",
  "Error 21: Incomplete PES Packet Header",
  "Error 22: Invalid PES Header",
  "Error 23: PES Packet Not Long Enough for Extended Header",
  "Error 24: PES Header Overflows File Length",
];
