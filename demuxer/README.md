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
  pts: number;
  dts: number;
  frame_ticks:   number;
  program:       number; // program number (1,2 ...)
  stream_number: number; // stream number in program
  type:          number; // media type / encoding
  stream_id:     number; // MPEG stream id
  content_type:  number; // 1 - audio, 2 - video
  frame_num:     number;
};
```

which can be used to dispatch the data in whatever way is appropriate. This callback is triggered immediately whenever a packet is completed.

Data is fed to the demuxer via `demuxer.process(data: Uint8Array)`. The chunks do not need to align with packet boundaries; the demuxer will hold on to partial data in between calls, so you can directly feed it with data from, e.g., a node.js readable stream. Once all data has been consumed, it is important to call `demuxer.finalize()` to let the demuxer know that no more data is coming. One additional packet may be emitted at that time, if there is partial packet data in the buffer.

The `demuxer.process(data)` method returns an integer status code. 0 indicates normal termination; 1 indicates that the last chunk of data ended in the middle of a frame, and more data is expected. Other numbers indicate various errors whose textual explanations can be looked up in the `ErrCodes` array.