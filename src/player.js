/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var HLSPlayer = (function(){
	'use strict';

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
		var seg, p;
		if(index >= player.segments.length){ return Promise.reject(null); }
		if(player.videos[index]){ return player.videos[index]; }
		
		p = new Promise(function(resolve, reject){
			player.resolvers[index] = resolve;
		});

		player.videos[index] = p;
		seg = player.segments[index];

		(new Promise(function(resolve){
			// Request segment data
			var xhr = new XMLHttpRequest();
			xhr.responseType = "arraybuffer";
			xhr.open("GET", seg.uri, true);
	
			if(seg.isRange){
				xhr.setRequestHeader("Range",
					"bytes="+seg.offset.toString(10) + "-" +
					(seg.offset+seg.bytelen-1).toString(10)
				);
				xhr.addEventListener('load', function(){
					if(this.status !== 206){ throw new Error("Incorrect Response Type"); }
					resolve(this.response);
				},false);
			}else{
				xhr.addEventListener('load', function(){
					resolve(this.response);
				},false);
			}

			xhr.send();
		})).then(function(arrbuffer){
			// Decrypt data if necessary
			var data = new Uint8Array(arrbuffer);
			if(seg.encryption.method !== "AES-128"){ return data; }
			player.decryptor.config({key: seg.encryption.key, iv: seg.encryption.iv});
			return player.decryptor.decrypt(data);
		}).then(function(data){
			// Demux TS data into packet streams
			return player.demuxer.process(data);
		}).then(function(packet_data){
			// Pass packet streams into MP4 Builder
			player.worker.postMessage({
				streams: packet_data.streams,
				index: index
			}, packet_data.buffers);
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
			that.index = index;
			that.ended = false;
			video.playbackRate = that.playbackRate;
			video.volume = that.volume;
			video.muted = that.muted;
			nextFrame(that, this);

			if(!that.loaded[index+1]){
				getSegment(that, index+1).then(function(next){
					video.addEventListener('ended', function(){
						if(!that.paused){ next.play(); }
					}, false);
				},function(){
					video.addEventListener('ended', function(){
						that.currentTime = 0;
						that.ended = true;
						that.paused = true;
						that.emit('ended', null);
					}, false);
				});
			}
		}, false);

		video.addEventListener('timeupdate', function(){
			if(that.seeking){ return; }
			that.setTime(base + video.currentTime);
			that.emit('timeupdate',null);
		}, false);

		video.src = URL.createObjectURL(new Blob([data.file], {type:'video/mp4'}));
		video.load();
	}

	function HLSPlayer(canvas, manifestURL){
		var that = this,
			currentTime = 0,
			playbackRate = 1,
			volume = 1,
			muted = false,
			worker = new Worker(remuxWorkerURL);

		worker.addEventListener('message', addVideo.bind(this), false);

		this.worker = worker;
		this.demuxer = new TSDemuxer();
		this.handlers = new Map();

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

		fetchHLSManifests(manifestURL).then(function(mlist){
			if(mlist.length === 0){ throw new Error("No Playlists Provided"); }
			mlist[0].listen(function(segments){
				var times = [], b = 0;

				segments.forEach(function(s){
					times.push(b);
					b += s.duration;
				});

				that.baseTimes = times;
				that.segments = segments;
				that.duration = b;

				getSegment(that, 0).then(function(video){
					nextFrame(that, video);
					that.readyState = 4;
					that.emit('ready', null);
				});
			});
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