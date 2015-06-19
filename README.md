HLS.js
=====

What?
-----

HLS.js is a pure-JS+HTML5, no-Flash, no-plugins, implementation of an HTTP Live Streaming video player. Development is sponsored by the [Brigham Young University Office of Digital Humanities](http://odh.byu.edu/).

HLS.js is aimed at developers creating more featureful video players who want to include HLS support on non-Apple devices. It is not aimed at people who just want to drop a video into a webpage with a pre-made embed code and forget about it. HLS.js will take you from "URL to an m3u8 manifest file" to "drawing pixels on the screen and piping sound to the speakers", and attempts to duplicate the standard HTML5 MediaElement API as closely as possible, but it does not come with any built-in UI. You have to build that yourself.

At the moment, HLS.js only supports Media Playlists (not Master Playlists) in VOD (not live streaming) mode. However, more features are planned, and contributions are welcome.

Why?
-----

Initial development was motivated by the need for a simple HLS plugin for the [Ayamel Media Player](https://github.com/BYU-ARCLITE/Ayamel.js) to allow for encrypted streaming of long-form video content for university language courses, where a simple HTML5 video element is considered insufficiently secure against potential piracy, directly from privately-controlled servers and without requiring students to install any plugins. Previous solutions either required uploading content to a third-party content management system (e.g., Youtube, Vimeo, Ooyala, Brightcove, etc.), the use of Flash video players, which will not run on all devices, unacceptable technology licensing restrictions, or some combination of the above.