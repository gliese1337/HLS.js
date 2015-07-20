/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var fetchHLSManifests = (function(){
	"use strict";

	var linePat = /^(#)?(EXT)?(.+?)$/mg,
		attrSeparator = /(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/;

	var keyPromises = {};
	function getKeyPromise(url){
		if(!keyPromises.hasOwnProperty(url)){
			keyPromises[url] = new Promise(function(resolve){
				var xhr = new XMLHttpRequest();
				xhr.responseType = "arraybuffer";
				xhr.addEventListener('load', function(){
					resolve(this.response);
				},false);
				xhr.open("GET", url, true);
				xhr.send();
			});
		}
		return keyPromises[url];
	}

	function validateString(s){
		if(!(s && s[0] === '"' && s[s.length-1] === '"')){ throw new Error("Expected Quoted String"); }
		s = s.substr(1,s.length-2);
		if(s.indexOf('"') !== -1){ throw new Error("Invalid Quoted String"); }
		return s;
	}
	function vaidateSignedFloat(s){
		var f = parseFloat(s);
		if(!isFinite(f)){ throw new Error("Invalid Float"); }
		return f;
	}
	function validateHex(s){
		return s;
	}
	function validateKeyFormats(s){
		return s;
	}

	function parseAttributes(line){
		var attrs = {};
		line.split(attrSeparator).forEach(function(s){
			if(s === ''){ return; }
			var p = s.split('=');
			attrs[p[0].trim()] = p[1].trim();
		});
		return attrs;
	}

	function parseMaster(input){
		// TODO: Add default settings.
		var settings = {},
			variants = [];

		//Clients SHOULD refuse to parse Playlists which contain a BOM
		if(input[0] === '\uFEFF'){ throw new Error("BOM detected"); }
		if(input.substr(0,7) !== "#EXTM3U"){ throw new Error("Missing EXTM3U tag."); }
	
		for(;match; match = linePat.exec(input)){
			if(match[1]){
				if(!match[2]){ continue; } //comment line
				parseTagMaster(match[3], settings);
			}else{ //Gotta be a URI line
				var variant = createVariant(match[0], settings);
				variants.push(variant);
			}
		}

		return {
			settings: settings,
			variants: variants
		};
	}

	function parseTagMaster(line, settings) {

		//Master Playlist Tags
		match = /-X-MEDIA:(.*)/.exec(line);
		if(match){
			parseMediaTag();
			return;
		}
		match = /-X-STREAM-INF:(.*)/.exec(line);
		if(match){
			parseStreamInfTag();
			return;
		}
		match = /-X-I-FRAME-STREAM-INF:(.*)/.exec(line);
		if(match){
			parseIFrameStreamTag();
			return;
		}
		match = /-X-SESSION-DATA:(.*)/.exec(line);
		if(match){
			parseSessionDataTag();
			return;
		}

		//Master or Media Playlist Tags
		match = /-X-VERSION/.exec(line);
		if(match){
			parseVersionTag();
		}

	}

	function parseMediaTag() {

	}

	function parseStreamInfTag() {

	}

	function parseIFrameStreamTag() {

	}

	function parseSessionDataTag() {
		
	}

	function parse(baseUrl, input){
		var match,
			segments = [],
			settings = {
				list_type: "",
				encryption: {
					format: "identity",
					formatSettings: {
						"identity": {
							method: "NONE",
							key: "",
							iv: "",
							formatVersions: ""
						}
					}
				},
				isFinished: false,
				hasMutability: false,
				mutability: "",
				mediaInit: null,
				dateTime: NaN,
				duration: 0,
				hasSegments: false,
				hasTargetDuration: false,
				targetDuration: 0,
				hasSequenceNo: false,
				sequenceNo: 0,
				hasDiscontinuitySequence: false,
				discontinuitySequence: 0,
				hasVersion: false,
				version: 1,
				hasOffset: false,
				offset: 0,
				hasRange: false,
				rangelen: 0,
				lastByteRange: null,
				hasIndependent: false,
				independent: false,
				hasStart: false,
				startOffset: 0,
				startPrecise: "NO"
			};

		//Clients SHOULD refuse to parse Playlists which contain a BOM
		if(input[0] === '\uFEFF'){ throw new Error("BOM detected"); }
		if(input.substr(0,7) !== "#EXTM3U"){ throw new Error("Missing EXTM3U tag."); }
		linePat.lastIndex = 7;
		match = linePat.exec(input);

		//Examine one line at a time
		for(;match; match = linePat.exec(input)){
			if(match[1]){
				if(!match[2]){ continue; } //comment line
				parseTag(match[3], settings);
			}else{ //Gotta be a URI line
				segments.push(createSegment(baseUrl, match[0], settings));
			}
		}

		return {
			settings: settings,
			segments: Promise.all(segments)
		};
	}

	function assert_media(settings){
		if(settings.list_type === "master"){
			throw new Error("Cannot use Media Segment tags in Master Playlist");
		}else{ settings.list_type = "media"; }
	}

	function assert_master(settings){
		if(settings.list_type === "media"){
			throw new Error("Cannot use Master tags in Media Playlist");
		}else{ settings.list_type = "master"; }
	}

	function parseTag(line,settings){
		var match;
		//Media Segment Tags
		match = /INF:(\d+(\.\d+)?),.*/.exec(line);
		if(match){
			parseInfTag(settings,match);
			return;
		}
		match = /-X-BYTERANGE:(\d+)(?:@(\d+))?$/.exec(line);
		if(match){
			parseByterangeTag(settings,match);
			return;
		}
		match = /-X-DISCONTINUITY/.exec(line);
		if(match){
			parseDiscontinuityTag(settings);
			return;
		}
		match = /-X-KEY:(.*)$/.exec(line);
		if(match){
			parseKeyTag(settings, parseAttributes(match[1]));
			return;
		}
		match = /-X-MAP:(.*)/.exec(line);
		if(match){
			parseMapTag(settings, parseAttributes(match[1]));
			return;
		}
		match = /-X-PROGRAM-DATE-TIME:(.*)/.exec(line);
		if(match){
			parseDateTimeTag(settings, match[1]);
			return;
		}

		//Media Playlist Tags
		match = /-X-VERSION:(\d+)/.exec(line);
		if(match){
			parseVersionTag(settings, match[1]);
			return;
		}
		match = /-X-TARGETDURATION:(\d+)/.exec(line);
		if(match){
			parseTargetDurationTag(settings, match[1]);
			return;
		}
		match = /-X-MEDIA-SEQUENCE:(\d+)/.exec(line);
		if(match){
			parseMediaSequenceTag(settings, match[1]);
			return;
		}
		match = /-X-DISCONTINUITY-SEQUENCE:(\d+)/.exec(line);
		if(match){
			parseDiscontinuitySequenceTag(settings, match[1]);
			return;
		}
		match = /-X-PLAYLIST-TYPE:(.*)/.exec(line);
		if(match){
			parsePlaylistTypeTag(settings, match[1]);
			return;
		}
		match = /-X-ENDLIST/.exec(line);
		if(match){
			parseEndlistTag(settings);
		}

		//Media or Master Playlist Tags
		match = /-X-INDEPENDENT-SEGMENTS/.exec(line);
		if(match){
			parseIndependentSegmentsTag(settings);
			return;
		}
		match = /-X-START:(.*)/.exec(line);
		if(match){
			parseStartTag(settings, parseAttributes(match[1]));
			return;
		}

		//Just ignore unrecognized tags
		//throw new Error("Unrecognized Tag");
	}

	function parseVersionTag(settings,num){
		assert_media(settings);
		if(settings.hasVersion){ throw new Error("Duplicate X-VERSION tags."); }
		if(settings.hasSegments){ throw new Error("X-VERSION tag must preceded media segments."); }
		settings.hasVersion = true;
		settings.version = parseInt(num,10);
	}

	function parseTargetDurationTag(settings,num){
		assert_media(settings);
		if(settings.hasTargetDuration){ throw new Error("Duplicate X-TARGETDURATION tags."); }
		if(settings.hasSegments){ throw new Error("X-TARGETDURATION tag must preceded media segments."); }
		settings.hasTargetDuration = true;
		settings.targetDuration = parseInt(num,10);
	}

	function parseMediaSequenceTag(settings,num){
		assert_media(settings);
		if(settings.hasSequenceNo){ throw new Error("Duplicate X-MEDIA-SEQUENCE tags."); }
		if(settings.hasSegments){ throw new Error("X-MEDIA-SEQUENCE tag must preceded media segments."); }
		settings.hasSequenceNo = true;
		settings.sequenceNo = parseInt(num,10);
	}

	function parseDiscontinuitySequenceTag(settings,num){
		assert_media(settings);
		if(settings.hasDiscontinuitySequence){ throw new Error("Duplicate X-DISCONTINUITY-SEQUENCE tags."); }
		if(settings.hasSegments){ throw new Error("X-DISCONTINUITY-SEQUENCE tag must preceded media segments."); }
		if(settings.mutability !== ""){ throw new Error("EVENT or VOD playlist may not contain X-DISCONTINUITY-SEQUENCE tag."); }
		settings.hasDiscontinuitySequence = true;
		settings.discontinuitySequence = parseInt(num,10);
	}

	function parsePlaylistTypeTag(settings,type){
		assert_media(settings);
		if(settings.hasMutability){
			throw new Error("Duplicate X-PLAYLIST-TYPE tags.");
		}
		if(settings.hasSegments){
			throw new Error("X-PLAYLIST-TYPE tag must preceded media segments.");
		}
		settings.hasMutability = true;
		switch(type){
		case "VOD": case "EVENT":
			if(settings.hasDiscontinuitySequence){
				throw new Error("EVENT or VOD playlist may not contain X-DISCONTINUITY-SEQUENCE tag.");
			}
			settings.mutability = type;
			break;
		default:
			throw new Error("Invalid Playlist Type");
		}
	}

	function parseEndlistTag(settings){
		assert_media(settings);
		if(settings.isFinished){
			throw new Error("Duplicate X-ENDLIST tags.");
		}
		settings.isFinished = true;
	}

	function parseIFrameTag(settings){
		assert_media(settings);
		//http://tools.ietf.org/html/draft-pantos-http-live-streaming-14#section-4.3.3.6
		throw new Error("X-I-FRAMES-ONLY tag not supported.");
	}

	function parseInfTag(settings,match){
		assert_media(settings);
		if(settings.version < 3){
			if(match[2]){ throw new Error("Invalid argument for EXTINF"); }
			settings.duration = parseInt(match[1],10);
		}else{
			settings.duration = parseFloat(match[1]);
		}
		/* //Brightcove violates this constraint
		if(Math.round(settings.duration) > settings.targetDuration){
			throw new Error("Segment duration cannot exceed Playlist Target Duration");
		}
		*/
	}

	function parseByterangeTag(settings,match){
		assert_media(settings);
		if(settings.version < 4){
			throw new Error("X-BYTERANGE tag requires version 4 or greater.");
		}
		settings.hasRange = true;
		settings.rangelen = parseInt(match[1],10);
		settings.hasOffset = !!match[2];
		if(settings.hasOffset){
			settings.offset = parseInt(match[2]);
		}
	}

	function parseDiscontinuityTag(settings){
		assert_media(settings);
		settings.discontinuitySequence++;
	}

	function parseMapTag(settings,attrs){
		assert_media(settings);
		throw new Error("X-MAP tag not supported.");
		//http://tools.ietf.org/html/draft-pantos-http-live-streaming-14#section-4.3.2.5
		/*
		var uri, byterange;
		if(attrs.URI === void 0){
			throw new Error("Missing URI attribute for X-MAP tag");
		}
		uri = validateString(attrs.URI);
		if(attrs.BYTERANGE === void 0){
			byterange = null;
		}else{
			byterange = validateByterange(attrs.BYTERANGE);
		}
		settings.mediaInit = {
			uri: uri, byterange: byterange
		};
		*/
	}

	function parseDateTimeTag(settings,date){
		assert_media(settings);
		throw new Error("X-PROGRAM-DATE-TIME tag not supported.");
		//http://tools.ietf.org/html/draft-pantos-http-live-streaming-14#section-4.3.2.6
		//settings.dateTime = validateDateTime(date);
	}

	function parseKeyTag(settings,attrs){
		/* It applies to every Media Segment that appears between
		 * it and the next EXT-X-KEY tag in the Playlist file with the same
		 * KEYFORMAT attribute (or the end of the Playlist file).
		 * TODO: Set up a map of KeyFormats
		 */
		var key, iv, format, versions;
		assert_media(settings);
		switch(attrs.METHOD){
		case void 0:
			throw new Error("METHOD attribute missing from X-KEY tag.");
		case "NONE":
			if(Object.keys(attrs).length > 1){
				throw new Error("Additional attributes disallowed for encryption method NONE.");
			}
			settings.encryption.format = "identity";
			encryption.formatSettings.identity = {
				method: "NONE",
				key: "", iv: "",
				formatVersions: ""
			};
			return;
		case "AES-128":
			if(attrs.URI === void 0){ throw new Error("Missing Encryption Key URI."); }
			key = validateString(attrs.URI);

			if(attrs.IV == void 0){
				iv = "";
			}else if(settings.version < 2){
				throw new Error("IV attribute requires version 2 or greater.");
			}else{
				iv = validateHex(attrs.IV);
			}

			if(attrs.KEYFORMAT === void 0){
				format = "identity";
			}else if(settings.version < 5){
				throw new Error("KEYFORMAT attribute requires version 5 of greater.");
			}else{
				format = validateString(attrs.KEYFORMAT);
			}

			if(attrs.KEYFORMATVERSIONS === void 0){
				versions = "1";
			}else if(settings.version < 5){
				throw new Error("KEYFORMATVERSIONS attribute requires version 5 of greater.");
			}else{
				versions = validateKeyFormats(attrs.KEYFORMATVERSIONS);
			}

			settings.encryption.format = format;
			settings.encryption.formatSettings[format] = {
				method: "AES-128",
				key: key, iv: iv,
				formatVersions: versions
			};
			break;
		case "SAMPLE-AES":
			throw new Error("SAMPLE-AES encryption not supported.");
		default:
			throw new Error("Invalid Encryption Method");
		}
	}

	function parseIndependentSegmentsTag(settings){
		if(settings.hasIdependent){
			throw new Error("Duplicate X-INDEPENDENT-SEGMENTS tags.");
		}
		settings.hasIndependent = true;
		settings.independent = true;
	}
	function parseStartTag(settings,attrs){
		if(settings.hasStart){
			throw new Error("Duplicate X-START tags.");
		}
		settings.hasStart = true;
		if(attrs['TIME-OFFSET'] === void 0){
			throw new Error("Missing TIME-OFFSET Attribute of X-START tag.");
		}
		settings.startOffset = validateSignedFloat(attrs['TIME-OFFSET']);
		switch(attrs.PRECISE){
		case "YES": case "NO":
			settings.startPrecise = attrs.PRECISE;
			break;
		default:
			throw new Error("Invalid value for PRECISE Attribute of X-START tag.");
		}
	}
	
	function createIV(num){
		var zeros = "00000000000000000000000000000000",
			hex = num.toString(16);
		return zeros.substr(hex.length)+hex;
	}

	function h2b(s){
		var i, l = s.length,
			b = new Uint8Array(Math.floor(l/2));
		for(i = 0; i < l; i+=2){
			b[i/2] = parseInt(s.substr(i,2),16);
		}
		return b.buffer;
	}

	function createSegment(baseUrl, line, settings){
		var format = settings.encryption.format,
			encSettings = settings.encryption.formatSettings[format],
			segment;

		segment = {
			uri: resolveURL(baseUrl, line),
			seqNo: settings.sequenceNo,
			discSeqNo: settings.discontinuitySequence,
			duration: settings.duration,
			offset: 0,
			byteLen: NaN,
			encryption: null
		}

		settings.sequenceNo++;

		if(settings.hasRange){
			settings.hasRange = false;
			if(!settings.hasOffset && line !== settings.lastByteRange){
				throw new Error("Missing byte range offset");
			}
			segment.offset = settings.offset;
			segment.bytelen = settings.rangelen;
			settings.offset += settings.rangelen;
			settings.lastByteRange = line;
		}else{
			settings.lastByteRange = null;
		}

		if(encSettings.method === "NONE"){
			segment.encryption = {
				method: "NONE", key: null, iv: null,
				format: "identity", formatVersions: "1"
			};
			return Promise.resolve(segment);
		}else{
			return getKeyPromise(encSettings.key).then(function(keybuffer){
				segment.encryption = {
					method: encSettings.method,
					key: keybuffer,
					iv: h2b(encSettings.iv || createIV(settings.sequenceNo)),
					format: format,
					formatVersions: encSettings.formatVersions
				};
				return segment;
			});
		}
	}

	var head = document.getElementsByTagName('head')[0],
		base = document.createElement('base'),
		resolver = document.createElement('a');

	// relative URL resolver
	function resolveURL(base_url, url){
		var resolved_url;
		head.appendChild(base);
		base.href = base_url;
		resolver.href = url;
		// browser magic at work here
		resolved_url  = resolver.href;
		head.removeChild(base);
		return resolved_url;
	}

	function getManifest(url){
		return new Promise(function(resolve, reject){
			var xhr = new XMLHttpRequest();
			xhr.addEventListener('load', function(){
				resolve(this.responseText);
			});
			xhr.open('GET', url, true);
			xhr.send();
		});
	}

	function M3U8Manifest(text, url){
		this.url = url;
		this.segments = [];
		this.listeners = [];

		this.refresh();
	}

	M3U8Manifest.prototype.refresh = function(){
		var that = this, settings;
		getManifest(this.url).then(function(text){
			var obj = parse(that.url, text);
			settings = obj.settings;
			return obj.segments;
		}).then(function(segments){
			var waitFraction = 1000;
			//TODO: compare with previous segment list
			// to generate diffs & determine the proper wait time
			that.segments = segments;

/*
   The client MUST periodically reload the Media Playlist file unless it
   contains the EXT-X-ENDLIST tag.

   However the client MUST NOT attempt to reload the Playlist file more
   frequently than specified by this section.

   When a client loads a Playlist file for the first time or reloads a
   Playlist file and finds that it has changed since the last time it
   was loaded, the client MUST wait for at least the target duration
   before attempting to reload the Playlist file again, measured from
   the last time the client began loading the Playlist file.

   If the client reloads a Playlist file and finds that it has not
   changed then it MUST wait for a period of one-half the target
   duration before retrying.

   ...
   
   HOWEVER, "If the tag is present and has a value of VOD, the Playlist file MUST NOT change."
   So there's really no point in reloading it in that case.
*/

			//Turn this on once the player is updated to handle
			//changes in the minfest
			/*if(settings.mutability !== "VOD" &&
				!(settings.mutability === "EVENT" && settings.isFinished)){
				setTimeout(
					function(){ that.refresh(); },
					settings.targetDuration*waitFraction
				);
			}*/

			that.emit(segments);
		});
	};

	M3U8Manifest.prototype.emit = function(segments){
		this.listeners.forEach(function(cb){
			setTimeout(cb.bind(null,segments),0);
		});
	};

	M3U8Manifest.prototype.listen = function(cb){
		this.listeners.push(cb);
	};

	M3U8Manifest.prototype.unlisten = function(cb){
		var idx = this.listeners.indexOf(cb);
		if(~idx){ this.listeners.splice(idx,1); }
	};

	function M3U8Master(text) {
		var parsed = parseMaster(text);
		this.settings = parsed.settings;
		this.variants = parsed.variants;
	}

	function isMaster(text){
		return false;
	}

	function manifestsFromMaster(text){
		var masterPlaylist = new M3U8Master(text);
		var manifests = [];
		var variants = masterPlaylist.variants;
		for(var i = 0; i < variants.length; i++) {
			var variant = variants[i];
			var url = variant.url;
			var text = getManifest(url);
			var manifest = new M3U8Manifest(text, url);
			manifests.push(manifest);
		}
		return manifests;
	}

	function fetchHLSManifests(url){
		var text = getManifest(url);
		if(isMaster(text)) {
			return manifestsFromMaster(text);
		}
		else {
			return Promise.resolve([new M3U8Manifest(text, url)]);
		}
	}

	return fetchHLSManifests;
}());