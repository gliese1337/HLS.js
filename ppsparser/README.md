H.264 PPS Parser
=====

PPS Parser provides a parser for H.264 Picture Sequence Parameter Sets. The package exports a single function, along with associated data type definitions:

```ts
function parse(nalu: Uint8Array, spss: Map<number, SPSInfo>): SPSInfo;
```

The input must be a single complete Network Access Layer unit (NALU) containing valid PPS data, along with a map from SPS (Sequence Parameter Set) IDs to SPSInfo data structures, which is used to retrieve the appropriate `chroma_format_idc` field to control PPS parsing. These structures can be acquired from the `h264-sps-parser` package, on which this package depends.