var HLSPlayer = (function(){
	'use strict';

	var doc_head = document.getElementsByTagName('head')[0],
		our_base = document.createElement('base'),
		resolver = document.createElement('a');

	// relative URL resolver
	function resolveURL(base_url, url){
		var resolved_url;
		doc_head.appendChild(our_base);
		our_base.href = base_url;
		resolver.href = url;
		resolved_url  = resolver.href; // browser magic at work here
		doc_head.removeChild(our_base);
		return resolved_url;
	}

	function getManifest(url){
		return new Promise(function(resolve, reject){
			var xhr = new XMLHttpRequest();
			xhr.addEventListener('load', function(){
				resolve(parseHLS(this.responseText));
			});
			xhr.open('GET', url, true);
			xhr.send();
		});
	}

	// drawing new frame
	function nextFrame(ctx, currentVideo){
		if(currentVideo.paused || currentVideo.ended){
			return;
		}
		ctx.drawImage(currentVideo, 0, 0);
		requestAnimationFrame(function(){ nextFrame(ctx, currentVideo); });
	}

	function getSegment(player, index){
		if(index === player.segments.length){ return; }
		var seg = player.segments[index],
			url = resolveURL(player.baseURL, seg.uri);
		(new Promise(function(resolve){
			var xhr = new XMLHttpRequest();
			xhr.responseType = "arraybuffer";
			xhr.addEventListener('load', function(){
				resolve(this.response);
			},false);
			xhr.open("GET", url, true);
			xhr.send();
		})).then(function(arrbuffer){
			var data = new Uint8Array(arrbuffer);
			if(seg.encryption.method === "AES-128"){
				return seg.encryption.key.then(function(keybuffer){
					player.decryptor.config({key: keybuffer, iv: seg.encryption.iv});
					return player.decryptor.decrypt(data);
				});
			}
			return data;
		}).then(function(data){
			player.worker.postMessage({buffer: data, url: url, index: index}, [data.buffer]);
		});
	}

	function addVideo(event){
		var that = this,
			data = event.data,
			canvas = this.canvas,
			ctx = this.ctx,
			video = document.createElement('video');

		console.log('Loaded', data.index);

		video.addEventListener('loadedmetadata', function(){
			if(canvas.width !== this.videoWidth || canvas.height !== this.videoHeight){
				canvas.width = this.width = this.videoWidth;
				canvas.height = this.height = this.videoHeight;
			}
		});

		video.addEventListener('play', function(){ nextFrame(ctx, this); }, false);
		video.addEventListener('ended', function(){
			that.videoIndex++;
			if(that.videos[that.videoIndex]){
				that.videos[that.videoIndex].play();
			}
		});

		if(!this.videos[data.index+1]){
			video.addEventListener('timeupdate', function checkRemaining(){
				if(this.duration - this.currentTime > 5){ return; }
				getSegment(that, data.index+1);
				this.removeEventListener('timeupdate', checkRemaining, false);
			}, false);
		}

		video.src = data.url;
		video.load();

		this.videos[data.index] = video;
		if(data.index === 0){
			this.readyState = 4;
			this.emit('ready');
		}
	}

	function HLSPlayer(canvas, manifestURL){
		var that = this,
			worker = new Worker('worker.js');
		worker.addEventListener('message', addVideo.bind(this), false);

		this.handlers = {};
		this.worker = worker;
		this.baseURL = manifestURL
		this.videos = [];
		this.videoIndex = 0;
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.decryptor = new AESDecryptor();
		this.segments = [];
		this.readyState = 0;
		
		getManifest(manifestURL).then(function(segments){
			that.segments = segments;
			getSegment(that, 0);
		});
	}

	HLSPlayer.prototype.emit = function(event, data){
		(this.handlers[event]||[]).forEach(function(cb){ cb(data); });
	};

	HLSPlayer.prototype.addEventListener = function(event, cb, capture){
		if(!this.handlers.hasOwnProperty(event)){
			this.handlers[event] = [cb];
		}else{
			this.handlers[event].push(cb);
		}
	};

	HLSPlayer.prototype.play = function(){
		this.videos[this.videoIndex].play();
	}


	HLSPlayer.prototype.pause = function(){
		this.videos[this.videoIndex].pause();
	}

	return HLSPlayer;
})();