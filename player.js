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
		var seg, url, p;
		if(index >= player.segments.length){ return Promise.reject(null); }
		if(player.videos[index]){ return player.videos[index]; }
		
		p = new Promise(function(resolve, reject){
			player.resolvers[index] = resolve;
		});

		player.videos[index] = p;
		seg = player.segments[index];
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
			if(seg.encryption.method !== "AES-128"){ return data; }
			return seg.encryption.key.then(function(keybuffer){
				player.decryptor.config({key: keybuffer, iv: seg.encryption.iv});
				return player.decryptor.decrypt(data);
			});
		}).then(function(data){
			player.worker.postMessage({
				buffer: data,
				index: index
			}, [data.buffer]);
		});

		return p;
	}

	function addVideo(event){
		var that = this,
			data = event.data,
			index = data.index,
			canvas = this.canvas,
			ctx = this.ctx,
			base = this.baseTimes[index],
			video = document.createElement('video');

		console.log('Loaded', index);

		video.addEventListener('loadedmetadata', function(){
			if(canvas.width !== this.videoWidth || canvas.height !== this.videoHeight){
				canvas.width = this.width = this.videoWidth;
				canvas.height = this.height = this.videoHeight;
			}
		});

		video.addEventListener('play', function(){ nextFrame(ctx, this); }, false);
		video.addEventListener('timeupdate', function(){
			that.setTime(base + video.currentTime);
		}, false);

		video.addEventListener('ended', function(){
			that.index++;
			getSegment(that, that.index).then(function(video){
				if(!that.paused){ video.play(); }
			});
		});

		if(!that.loaded[index+1]){
			video.addEventListener('timeupdate', function checkRemaining(){
				if(!that.loaded[index+1]){
					if(this.duration - this.currentTime > 5){ return; }
					getSegment(that, index+1);
				}
				this.removeEventListener('timeupdate', checkRemaining, false);
			}, false);
		}

		video.src = data.url;
		video.load();

		this.loaded[index] = true;
		this.resolvers[index](video);
	}

	function HLSPlayer(canvas, manifestURL){
		var that = this,
			currentTime = 0,
			worker = new Worker('worker.js');
		worker.addEventListener('message', addVideo.bind(this), false);

		this.handlers = {};
		this.worker = worker;
		this.baseURL = manifestURL;
		this.index = 0;
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d');
		this.decryptor = new AESDecryptor();
		
		this.resolvers = {};
		this.videos = {};
		this.loaded = {};
		this.segments = [];
		this.baseTimes = [];

		this.paused = true;
		this.duration = 0;
		this.readyState = 0;

		Object.defineProperties(this,{
			setTime: { value: function(t){ currentTime = t; } },
			currentTime: {
				get: function(){ return currentTime; },
				set: function(t){
					var i, d,
						segs = this.segments,
						len = segs.length;

					t = +t||0;
					currentTime = t;

					end: {
						for(i = 0; i < len; i++){
							d = segs[i].duration;
							if(d > t){ break end; }
							t -= d;
						}

						t = d;
						i = len - 1;
						currentTime = baseTime;
					}

					if(!this.paused){
						getSegment(this, this.index)
							.then(function(video){ video.pause(); });
					}

					this.index = i;
					getSegment(this, i).then(function(video){
						video.currentTime = t;
						if(!this.paused){ video.play(); }
					});

					return currentTime;
				}
			}
		});

		getManifest(manifestURL).then(function(segments){
			var times = [], b = 0;

			segments.forEach(function(s){
				times.push(s.duration);
				b += s.duration;
			});

			that.baseTimes = times;
			that.segments = segments;
			that.duration = b;

			return getSegment(that, 0);
		}).then(function(video){
			that.readyState = 4;
			that.emit('ready');
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
		var that = this;
		if(!this.paused){ return; }
		getSegment(this, this.index).then(function(video){
			that.paused = false;
			video.play();
		});
	}


	HLSPlayer.prototype.pause = function(){
		var that = this;
		if(this.paused){ return; }
		getSegment(this, this.index).then(function(video){
			that.paused = true;
			video.pause();
		});
	}

	return HLSPlayer;
})();