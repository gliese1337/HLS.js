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
	function nextFrame(player, video){
		var scale, w, h,
			cw = player.canvas.width,
			ch = player.canvas.height,
			vw = video.videoWidth,
			vh = video.videoHeight;

		scale = Math.min(cw/vw, ch/vh);
		w = vw * scale;
		h = vh * scale;

		player.ctx.drawImage(video, (cw - w)/2, (ch - h)/2, w, h);
		if(!(player.seeking || video.paused || video.ended)){
			requestAnimationFrame(function(){ nextFrame(player, video); });
		}
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

		video.addEventListener('loadedmetadata', function(){
			that.loaded[index] = true;
			that.resolvers[index](video);
		});

		video.addEventListener('play', function(){
			that.ended = false;
			video.playbackRate = that.playbackRate;
			video.volume = that.volume;
			video.muted = that.muted;
			nextFrame(that, this);
		}, false);
		video.addEventListener('timeupdate', function(){
			if(that.seeking){ return; }
			that.setTime(base + video.currentTime);
			that.emit('timeupdate',null);
		}, false);

		video.addEventListener('ended', function(){
			that.index++;
			//that.paused = true;
			//that.emit('pause');
			getSegment(that, that.index).then(function(video){
				console.log('Playing', that.index);
				if(!that.paused){ video.play(); }
			},function(){
				that.ended = true;
				that.paused = true;
				that.emit('ended', null);
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
	}

	function HLSPlayer(canvas, manifestURL){
		var that = this,
			currentTime = 0,
			playbackRate = 1,
			volume = 1,
			muted = false,
			worker = new Worker('worker.js');

		worker.addEventListener('message', addVideo.bind(this), false);

		this.worker = worker;
		this.handlers = new Map();

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

		this.seeking = false;
		this.ended = false;
		this.paused = true;
		this.duration = 0;
		this.readyState = 0;

		Object.defineProperties(this,{
			setTime: { value: function(t){ currentTime = t; } },
			currentTime: {
				get: function(){ return currentTime; },
				set: function(t){
					var that = this, i, d,
						segs = this.segments,
						len = segs.length;

					t = +t||0;
					if(currentTime === t){ return currentTime; }
					currentTime = t;
					this.seeking = true;
					this.ended = false;

					end: {
						for(i = 0; i < len; i++){
							d = segs[i].duration;
							if(d > t){ break end; }
							t -= d;
						}

						t = d;
						i = len - 1;
						currentTime = d;
						this.ended = true;
						this.paused = true;
					}

					if(this.index === i){
						getSegment(this, this.index)
							.then(function(video){ video.currentTime = t; });
					}else{
						if(!this.paused){
							getSegment(this, this.index)
								.then(function(video){ video.pause(); });
						}

						this.index = i;
						getSegment(this, i).then(function(video){
							that.seeking = false;
							if(!that.paused){
								// This trickery seems necessary to ensure audio loads properly
								video.play();
								video.currentTime = t;
							}else{
								video.currentTime = t;
								nextFrame(that, video);
							}
						});
					}

					that.emit('seek',null);
					return currentTime;
				}
			},
			volume: {
				get: function(){ return volume; },
				set: function(v){
					v = Math.min(Math.max(0, +v||0), 1);
					if(volume === v){ return volume; }
					volume = v;
					if(!this.paused){
						getSegment(this, this.index).then(function(video){
							video.volume = v;
						});
					}
					return volume;
				}
			},
			muted: {
				get: function(){ return muted; },
				set: function(m){
					m = !!m;
					if(muted === m){ return muted; }
					muted = m;
					if(!this.paused){
						getSegment(this, this.index).then(function(video){
							video.muted = m;
						});
					}
					return muted;
				}
			},
			playbackRate: {
				get: function(){ return playbackRate; },
				set: function(r){
					r = Math.max(0, +r||0);
					if(playbackRate === r){ return playbackRate; }
					playbackRate = r;
					if(!this.paused){
						getSegment(this, this.index).then(function(video){
							video.playbackRate = r;
						});
					}
					return playbackRate;
				}
			}
		});

		getManifest(manifestURL).then(function(segments){
			var times = [], b = 0;

			segments.forEach(function(s){
				times.push(b);
				b += s.duration;
			});

			that.baseTimes = times;
			that.segments = segments;
			that.duration = b;

			return getSegment(that, 0);
		}).then(function(video){
			nextFrame(that, video);
			that.readyState = 4;
			that.emit('ready', null);
		});
	}

	HLSPlayer.prototype.emit = function(event, data){
		this.canvas.dispatchEvent(new CustomEvent(
			event, {bubbles:true,detail:data}
		));
	};

	HLSPlayer.prototype.addEventListener = function(event, cb, capture){
		var bound = cb.bind(this);
		this.handlers.set(cb, {c: !!capture, f: bound});
		this.canvas.addEventListener(event, bound, !!capture);
	};

	HLSPlayer.prototype.removeEventListener = function(event, cb, capture){
		var o = this.handlers.get(cb);
		this.handlers.delete(cb);
		this.canvas.removeEventListener(event, o.f, o.c);
	};

	HLSPlayer.prototype.play = function(){
		var that = this;
		if(!this.paused){ return; }
		this.paused = false;
		this.emit('play',null);
		getSegment(this, this.index).then(function(video){
			if(that.paused){ return; }
			video.play();
		});
	}


	HLSPlayer.prototype.pause = function(){
		var that = this;
		if(this.paused){ return; }
		this.paused = true;
		this.emit('pause', null);
		getSegment(this, this.index).then(function(video){
			if(!that.paused){ return; }
			video.pause();
		});
	}

	return HLSPlayer;
})();