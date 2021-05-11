H.264 SPS Parser
=====

SPS Parser provides a parser for H.264 Video Sequence Parameter Sets. The package exports a parse function, along with its return data type definition:

```ts
function parse(nalu: Uint8Array): SPSInfo;
```

The input must be a single complete Network Access Layer unit (NALU) containing valid SPS data.