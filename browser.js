(function(){
	'use strict';

	var scripts = document.getElementsByTagName('script'),
		manifest = scripts[scripts.length-1].getAttribute('data-hls'),
		decryptor = new AESDecryptor();

	document.getElementById('play').addEventListener('click',function(){
		getStream(manifest);
	},false);

	// relative URL resolver
	var resolveURL = (function(){
		var doc_head = document.getElementsByTagName('head')[0],
			our_base = document.createElement('base'),
			resolver = document.createElement('a');

		return function(base_url, url){
			var resolved_url;
			doc_head.appendChild(our_base);
			our_base.href = base_url;
			resolver.href = url;
			resolved_url  = resolver.href; // browser magic at work here
			doc_head.removeChild(our_base);

			return resolved_url;
		};
	})();

	// loading more videos from manifest
	function loadSegment(seg){
		return (new Promise(function(resolve){
			var xhr = new XMLHttpRequest(),
				url = resolveURL(manifest, seg.uri);
			xhr.responseType = "arraybuffer";
			xhr.addEventListener('load', function(){
				resolve(this.response);
			},false);
			xhr.open("GET", url, true);
			xhr.send();
		})).then(function(arrbuffer){ //handle possibly encrypted segment data
			var data = new Uint8Array(arrbuffer);
			if(seg.encryption.method === "AES-128"){
				return seg.encryption.key.then(function(keybuffer){
					decryptor.config({key: keybuffer, iv: seg.encryption.iv});
					return decryptor.decrypt(data);
				});
			}
			return data;
		}).then(function(tsdata){ //demux plaintext MPEG-TS data
			var audio, video, streams, dm = new TSDemuxer();
			dm.process(tsdata);
			streams = dm.streams;
			return {
				audio: streams.filter(function(s){ return s.content_type === 1; }),
				video: streams.filter(function(s){ return s.content_type === 2; })
			};
		});
		//TODO: Remux into an MP4 container
	}

	function getStream(url){
		var ajax = new XMLHttpRequest();
		ajax.addEventListener('load', function(){
			var segments = parseHLS(this.responseText).slice(0,5);
			segments.map(loadSegment).forEach(function(p){
				p.then(function(media){
					//TODO: Actually load media into a video element
					media.video.forEach(function(s){
						console.log("channel " + s.program +
								", track " + s.id +
								", stream 0x" + s.stream_id.toString(16) +
								", type 0x" + s.type.toString(16) +
								", length " + s.length + "s (" + s.fps + "fps)");
					});
				});
			});
		});
		ajax.open('GET', url, true);
		ajax.send();
	}
})();