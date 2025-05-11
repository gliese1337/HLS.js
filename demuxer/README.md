TS-Demuxer
=====

TS-Demuxer provides an incremental demuxer for MPEG-TS data streams. Basic usage is as follows:

```ts
import { TSDemuxer, ErrCodes } from 'ts-demuxer';

const demuxer = new TSDemuxer((packet) => {
  switch (packet.stream_id) {
    case 0xE0: /* Do stuff with a video packet. */ break;
    case 0xC0: /* Do stuff with an audio packet. */ break;
  }
});

for (const chunk of /* source of data */) {
  const err = demuxer.process(chunk);
  if (err > 1) throw new Error(`${ err }, ${ ErrCodes[err] }`);
}

demuxer.finalize();
```

The `TSDemuxer` constructor takes a callback which recieves a packet structure with the following format:

```ts
type Packet = {
  data: Uint8Array;
  pts: number;   // presentation time stamp
  dts: number;   // decoding time stamp
  frame_ticks:   number; // time stamp ticks per frame
  program:       number; // program number (1,2 ...)
  stream_number: number; // stream number in program
  type:          number; // media type / encoding; int -> string mappings in `StreamTypes`
  stream_id:     number; // MPEG stream id
  content_type:  number; // 1 - audio, 2 - video; int -> string mappings in `ContentTypes`
  frame_num:     number;
};
```

which can be used to dispatch the data in whatever way is appropriate. This callback is triggered immediately whenever a packet is completed.

The full API is as follows:

```ts
type DemuxOptions = {
    copy?: boolean;
};

class TSDemuxer {
    offset: number;
    readonly pids: Map<number, Stream>;
    constructor(cb: (p: Packet) => void, opts?: DemuxOptions);
    static resync(buffer: Uint8Array, offset?: number): number;
    process(buffer: Uint8Array, offset?: number, len?: number): number;
    finalize(): void;
}
```

Data is fed to the demuxer via `demuxer.process(data: Uint8Array, offset = 0, len = data.length - offset)`. The chunks do not need to align with packet boundaries; the demuxer will hold on to partial data in between calls, so you can directly feed it with data from, e.g., a node.js readable stream. The first data chunk, however, must be aligned to the start of a packet. To ensure this, the static `resync` method can be used to find the first offset of the beginning of a packet in a chunk. Once all data has been consumed, it is important to call `demuxer.finalize()` to let the demuxer know that no more data is coming. One additional packet per multiplexed stream may be emitted at that time, if there is partial packet data left over that has not yet been emitted.

The `demuxer.process(data)` method returns an integer status code. 0 indicates normal termination; 1 indicates that the last chunk of data ended in the middle of a frame, and more data is expected. Other numbers indicate various errors whose textual explanations can be looked up in the `ErrCodes` array.

If an error is returned, `demuxer.offset` will be set to the offset in the data buffer where the last packet for which demuxing was attempted is located. This can be used to try resyncing and continuing demuxing without dropping packets.

By default `Packet` data will alias the original `ArrayBuffer`s underlying the `Uint8Array`s passed into `demuxer.process` (except where it is necessary to allocate a new buffer to hold packet data the broken across original buffer boundaries). In order to force allocation of new buffers for all packets, construct the `TSDemuxer` object with the `{ copy: true }` option.

Metadata for individual streams can be inspected during and after demuxing via the readonly `demuxer.pids` property. The map values are objects of the following form:

```ts
class Stream {
    program: number;
    id: number;
    type: number;
    stream_id: number;
    content_type: number;
    pcr: number;
    first_pcr: number;
    dts: number;
    has_dts: boolean;
    first_pts: number;
    last_pts: number;
    has_pts: boolean;
    frame_ticks: number;
    frame_num: number;
}
```