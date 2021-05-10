import { get_stream, Stream } from "./stream";

export function decode_pat(mem: DataView, ptr: number, len: number, pids: Map<number, Stream>, pstart: number): number {
  if (pstart) {
    if (len < 1) { return 6; } // Incomplete PES Packet (Possibly PAT)
    ptr += 1; // skip pointer field
    len -= 1;
  }

  //check table ID
  if (mem.getUint8(ptr) !== 0x00) { return 0; } // not a PAT after all
  if (len < 8) { return 7; } // Incomplete PAT

  // check flag bits and length
  let l = mem.getUint16(ptr + 1);
  if ((l & 0xb000) !== 0xb000) { return 8; } // Invalid PAT Header

  l &= 0x0fff;
  len -= 3;

  if (l > len) { return 9; } // PAT Overflows File Length

  len -= 5;
  ptr += 8;
  l -= 5 + 4;

  if (l % 4) { return 10; } // PAT Body Isn't a Multiple of the Entry Size (32 bits)

  const n = l / 4;
  for (let i = 0;i < n;i++) {
    const program = mem.getUint16(ptr);
    let pid = mem.getUint16(ptr + 2);

    // 3 reserved bits should be on
    if ((pid & 0xe000) !== 0xe000) { return 11; } // Invalid PAT Entry

    pid &= 0x1fff;
    ptr += 4;

    const s = get_stream(pids, pid);
    s.program = program;
    s.type = 0xff;
  }

  return 0;
}