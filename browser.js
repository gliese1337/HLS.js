(function(){
	'use strict';

	var player = null,
		canvas = document.getElementById('canvas'),
		playbtn = document.getElementById('play'),
		seeker = document.getElementById('seeker'),
		rate = document.getElementById('rate'),
		volume = document.getElementById('volume'),
		manifest = document.getElementById('manifest');

	function playpause(){
		player[(player.paused)?'play':'pause']();
	}

	function init(){
		player = new HLSPlayer(canvas, manifest.value);
		playbtn.removeEventListener('click', init, false);
		player.addEventListener('ready', function(){
			playbtn.textContent = "Play";
			playbtn.addEventListener('click', playpause, false);

			seeker.max = player.duration;
			seeker.addEventListener('change', function(){
				player.currentTime = seeker.value;
			}, false);

			rate.addEventListener('change', function(){
				player.playbackRate = rate.value;
			}, false);

			volume.addEventListener('change', function(){
				player.volume = volume.value;
			}, false);
		}, false);
		player.addEventListener('timeupdate',function(){
			seeker.value = player.currentTime;
		}, false);
		player.addEventListener('play', function(){ playbtn.textContent = "Pause"; }, false);
		player.addEventListener('pause', function(){ playbtn.textContent = "Play"; }, false);
		player.addEventListener('ended', function(){
			playbtn.textContent = "Play";
			player.currentTime = 0;
		}, false);
	}

	playbtn.addEventListener('click', init, false);

})();