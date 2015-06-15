if not exist bin mkdir bin
echo var HLSPlayer = (function(){ > bin\HLSPlayer.js
echo var remuxWorkerURL = URL.createObjectURL(new Blob(['('+function(){ >> bin\HLSPlayer.js
type src\SPSParser.js >> bin\HLSPlayer.js
type src\MP4Muxer.js >> bin\HLSPlayer.js
type src\worker.js >> bin\HLSPlayer.js
echo }.toString()+')()'], {type:'text/javascript'})); >> bin\HLSPlayer.js
type src\M3U8.js >> bin\HLSPlayer.js
type src\AESDecrypt.js >> bin\HLSPlayer.js
type src\TSDemuxer.js >> bin\HLSPlayer.js
type src\player.js >> bin\HLSPlayer.js
echo return HLSPlayer;})(); >> bin\HLSPlayer.js
jsmin.exe <bin\HLSPlayer.js >bin\HLSPlayer.min.js
del bin\HLSPlayer.js


