(function(){
	'use strict';

	var worker = new Worker('worker.js'),
		videoIndex = 0,
		videos = [],
		canvas = document.getElementById('canvas'),
		context = canvas.getContext('2d'),
		playbtn = document.getElementById('play'),
		manifest = document.getElementById('manifest'),
		downloads = document.getElementById('downloads'),
		decryptor = new AESDecryptor();

	// drawing new frame
	function nextFrame(currentVideo){
		if(currentVideo.paused || currentVideo.ended){
			return;
		}
		context.drawImage(currentVideo, 0, 0);
		requestAnimationFrame(function(){ nextFrame(currentVideo); });
	}

	function playpause(){
		var currentVideo = videos[videoIndex];
		if(!currentVideo){ return; }
		if(this.textContent === "Pause"){
			this.textContent = "Play";
			currentVideo.pause();
		}else{
			this.textContent = "Pause";
			currentVideo.play();
		}
	}

	function init(){
		getStream(manifest.value);
		playbtn.removeEventListener('click', init, false);
		playbtn.textContent = "Pause";
		playbtn.addEventListener('click', playpause, false);
	}

	playbtn.addEventListener('click', init, false);

	function addDownload(url, name){
		var a = document.createElement('a');
		a.href = url;
		a.textContent = name;
		a.download = name;
		downloads.appendChild(a);
		downloads.appendChild(document.createElement('br'));
	}

	worker.addEventListener('message', function(event){
		var video, data = event.data,
			descriptor = '#' + data.index + ': ' + data.original;

		switch(data.type){
			// worker is ready to convert
			case 'ready':
				playbtn.disabled = false;
				return;

			// got new converted MP4 video data
			case 'video':
				video = document.createElement('video');

				video.addEventListener('loadedmetadata', function(){
					if(canvas.width !== this.videoWidth || canvas.height !== this.videoHeight){
						canvas.width = this.width = this.videoWidth;
						canvas.height = this.height = this.videoHeight;
					}
				});

				video.addEventListener('play', function(){
					console.log("playing", descriptor);
					nextFrame(this);
				}, false);

				video.addEventListener('ended', function(){
					videoIndex++;
					if(videoIndex < videos.length){
						videos[videoIndex].play();
					}
				});

				addDownload(data.url, data.index+'.mp4');

				video.src = data.url;
				video.load();

				videos[data.index] = video;
				if(videoIndex === videos.length - 1){
					video.play();
				}
		}
	});

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
	function loadSegments(manifest, segments, i){
		if(i === segments.length || i === 20){ return; }
		var seg = segments[i],
			url = resolveURL(manifest, seg.uri);
		(new Promise(function(resolve){
			var xhr = new XMLHttpRequest();
			xhr.responseType = "arraybuffer";
			xhr.addEventListener('load', function(){
				resolve(this.response);
			},false);
			xhr.open("GET", url, true);
			xhr.send();
		})).then(function(arrbuffer){
			loadSegments(manifest, segments, i+1);

			var data = new Uint8Array(arrbuffer);
			if(seg.encryption.method === "AES-128"){
				return seg.encryption.key.then(function(keybuffer){
					decryptor.config({key: keybuffer, iv: seg.encryption.iv});
					return decryptor.decrypt(data);
				});
			}
			return data;
		}).then(function(data){
			worker.postMessage({buffer: data, url: url, index: i}, [data.buffer]);
		});
	}
	
	function getStream(url){
		var ajax = new XMLHttpRequest();
		ajax.addEventListener('load', function(){
			var segments = parseHLS(this.responseText).slice(0,20);
			loadSegments(url, segments, 0);

			console.log('asked for ' + segments.length + ' more videos');
		});
		ajax.open('GET', url, true);
		ajax.send();
	}

})();