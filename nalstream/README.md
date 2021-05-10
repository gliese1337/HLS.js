TS-NALStream
=====

TS-NALStream provides a parser for Network Access Layer units from MPEG-TS video streams. The package exports a single function:

```ts
function parseNALStream(bytes: Uint8Array | Iterable<Uint8Array>): Generator<Uint8Array>;
```

The input is either a single data array from a video `Packet` produced by `ts-demuxer`, or an iterable of data arrays from sequential `Packet`s. The output is a sequence of `Uint8Array`s (aliasing the input bufers) referring to individual NAL units with encoded H.254 or HEVC video data.