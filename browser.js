(function(){
	'use strict';

	var worker = new Worker('worker.js'),
		nextIndex = 0,
		sentVideos = 0,
		currentVideo = null,
		videos = [],
		lastOriginal,
		canvas = document.getElementById('canvas'),
		context = canvas.getContext('2d'),
		startbtn = document.getElementById('start'),
		manifest = document.getElementById('manifest'),
		decryptor = new AESDecryptor();

	// drawing new frame
	function nextFrame(){
		if(currentVideo.paused || currentVideo.ended){
			return;
		}
		context.drawImage(currentVideo, 0, 0);
		requestAnimationFrame(nextFrame);
	}

	startbtn.addEventListener('click', function(){
		getStream(manifest.value);
		this.disabled = true;
	}, false);

	worker.addEventListener('message', function(event){
		var video, data = event.data,
			descriptor = '#' + data.index + ': ' + data.original;

		switch(data.type){
			// worker is ready to convert
			case 'ready':
				startbtn.disabled = false;
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
					if(currentVideo !== this){
						if(!currentVideo){
							document.body.classList.remove('loading');
							['play', 'pause'].forEach(function(action){
								document.getElementById(action).addEventListener('click', function(){
									document.body.classList.toggle('paused');
									currentVideo[action]();
								});
							});
						}
						console.log('playing ' + descriptor);
						currentVideo = this;
						nextIndex++;
						/*if(sentVideos - nextIndex <= 1){
							getMore();
						}*/
					}
					nextFrame();
				});

				video.addEventListener('ended', function(){
					delete videos[nextIndex - 1];
					if(nextIndex in videos){
						videos[nextIndex].play();
					}
				});
				if(video.src.slice(0, 5) === 'blob:'){
					video.addEventListener('ended', function(){
						URL.revokeObjectURL(this.src);
					});
				}

				video.src = data.url;
				video.load();

				console.log('converted ' + descriptor);
				videos[data.index] = video;
				if((!currentVideo || currentVideo.ended) && data.index === nextIndex){
					video.play();
				}

				return;
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
	function loadSegments(manifest, segments, sent, i){
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
			loadSegments(manifest, segments, sent, i+1);

			var data = new Uint8Array(arrbuffer);
			if(seg.encryption.method === "AES-128"){
				return seg.encryption.key.then(function(keybuffer){
					decryptor.config({key: keybuffer, iv: seg.encryption.iv});
					return decryptor.decrypt(data);
				});
			}
			return data;
		}).then(function(data){
			worker.postMessage({buffer: data, url: url, index: sent + i}, [data.buffer]);
		});
	}
	
	function getStream(url){
		var ajax = new XMLHttpRequest();
		ajax.addEventListener('load', function(){
			var segments = parseHLS(this.responseText).slice(0,20);
			loadSegments(url, segments, sentVideos, 0);
			sentVideos += segments.length;

			console.log('asked for ' + segments.length + ' more videos');
		});
		ajax.open('GET', url, true);
		ajax.send();
	}

})();