(function(){
	'use strict';

	var player = null,
		canvas = document.getElementById('canvas'),
		playbtn = document.getElementById('play'),
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
		}, false);
	}

	playbtn.addEventListener('click', init, false);

})();