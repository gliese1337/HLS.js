(function(){
	'use strict';

	var player = null,
		canvas = document.getElementById('canvas'),
		playbtn = document.getElementById('play'),
		seeker = document.getElementById('seeker'),
		manifest = document.getElementById('manifest');

	function playpause(){
		if(this.textContent === "Pause"){
			this.textContent = "Play";
			player.pause();
		}else{
			this.textContent = "Pause";
			player.play();
		}
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
		}, false);
		player.addEventListener('timeupdate',function(){
			seeker.value = player.currentTime;
		}, false);
	}

	playbtn.addEventListener('click', init, false);

})();