function ExpGolomInit(view: DataView, bitoffset: number): { zeros: number; skip: number; byt: number; byteoffset: number } {
  let bit = 0;
  let byteoffset = bitoffset >> 3;
  let skip = bitoffset & 7;
  let zeros = -1;

  let byt = view.getUint8(byteoffset) << skip;
  do {
    bit = byt & 0x80;
    byt <<= 1;
    zeros++;
    skip++;
    if (skip === 8) {
      skip = 0;
      byteoffset++;
      byt = view.getUint8(byteoffset);
    }
  } while (!bit);

  return { zeros, skip, byt, byteoffset };
}

const shift32 = 2 ** 32;
const shift16 = 2 ** 16;
const shift8 = 2 ** 8;
const shift4 = 2 ** 4;
const mask = [0, 1, 3, 7, 15, 31, 63, 127];

export class Bitstream {
  public bitoffset = 0;
    constructor (public view: DataView) {}

  ExpGolomb(): number {
    const { view } = this;
    let {
      zeros, skip, byt, byteoffset,
    } = ExpGolomInit(view, this.bitoffset);
    
    let code = 1;
    while (zeros > 0) {
      code = (code << 1) | ((byt & 0x80) >>> 7);
      byt <<= 1;
      skip++;
      zeros--;
      if (skip === 8) {
        skip = 0;
        byteoffset++;
        byt = view.getUint8(byteoffset);
      }
    }
    
    this.bitoffset = (byteoffset << 3) | skip;
    return code - 1;
  }

  SignedExpGolomb(): number {
    const code = this.ExpGolomb();
    return code & 1 ? (code + 1) >>> 1 : -(code >>> 1);
  }

  readBit(): 0 | 1 {
    const skip = this.bitoffset & 7;
    const byteoffset = this.bitoffset >> 3;
    this.bitoffset++;
    return ((this.view.getUint8(byteoffset) >>> (7 - skip)) & 1) as 0|1;
  }
  
  // n < 8
  readN(n: number): number {
    const skip = this.bitoffset & 7;
    const byteoffset = this.bitoffset >> 3;
    this.bitoffset += n;

    const inv = 8 - n;
    const high = this.view.getUint8(byteoffset);
    if (skip === 0) return high >>> inv;
    if (skip <= inv) return (high >>> (inv - skip));

    const low = this.view.getUint8(byteoffset + 1);

    return ((high << (skip - inv)) | (low >>> (8 + inv - skip))) & mask[n];
  }
  
  readByte(): number {
    const skip = this.bitoffset & 7;
    const byteoffset = this.bitoffset >>> 3;
    this.bitoffset += 8;

    const high = this.view.getUint8(byteoffset);
    if (skip === 0) return high;

    const low = this.view.getUint8(byteoffset + 1);

    return (high << skip) | (low >>> (8 - skip));
  }

  readWord(): number {
    const skip = this.bitoffset & 7;
    const byteoffset = this.bitoffset >>> 3;
    this.bitoffset += 32;

    const { view } = this;

    const tmp = (view.getUint16(byteoffset) * shift16) +
                view.getUint16(byteoffset + 2);

    if (skip === 0) return tmp;
    
    return (tmp * (2 ** skip)) + (view.getUint8(byteoffset + 4) >>> (8 - skip));
  }

  readV(v: number): number {
    let n = 0;
    while (v >= 32) {
      n = n * shift32 + this.readWord();
      v -= 32;
    }
    while (v >= 8) {
      n = n * shift8 + this.readByte();
      v -= 8;
    }

    return n * (2 ** v) + this.readN(v);
  }

  more_rbsp_data(): boolean {
    const skip = this.bitoffset & 7;
    let byteoffset = this.bitoffset >> 3;
    const l = this.view.byteLength;
    if (byteoffset >= l) return false;
    let byte = (this.view.getUint8(byteoffset) << skip) & 0xff;
    let found_bit = byte > 0;
    if (found_bit && !Number.isInteger(Math.log2(byte))) return true;
    while (++byteoffset < l) {
      byte = this.view.getUint8(byteoffset);
      const has_bit = byte > 0;
      if (found_bit && has_bit) return true;
      if (has_bit && !Number.isInteger(Math.log2(byte))) return true;
      found_bit = found_bit || has_bit;
    }

    return false;
  }
}
