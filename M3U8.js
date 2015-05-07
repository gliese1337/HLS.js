var parseHLS = (function(){
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

	function parse(input){
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
				if(match[3] === "-X-ENDLIST"){ break; }
				parseTag(match[3], settings);
			}else{ //Gotta be a URI line
				segments.push(createSegment(match[0], settings));
			}
		}

		return segments;
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
		settings.hasDiscontinuitySequence = true;
		settings.discontinuitySequence = parseInt(num,10);
	}

	function parsePlaylistTypeTag(settings,type){
		assert_media(settings);
		if(settings.hasDiscontinuitySequence){ throw new Error("Duplicate X-PLAYLIST-TYPE tags."); }
		if(settings.hasSegments){ throw new Error("X-PLAYLIST-TYPE tag must preceded media segments."); }
		settings.hasMutability = true;
		switch(type){
		case "VOD": case "EVENT":
			settings.mutability = type;
			break;
		default:
			throw new Error("Invalid Playlist Type");
		}
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

	function createSegment(line, settings){
		var format = settings.encryption.format,
			encSettings = settings.encryption.formatSettings[format],
			segment;

		segment = {
			uri: line,
			seqNo: settings.sequenceNo,
			discSeqNo: settings.discontinuitySequence,
			duration: settings.duration,
			offset: 0,
			byteLen: NaN,
			encryption: (encSettings.method === "NONE")?{
				method: "NONE", key: null, iv: null,
				format: "identity", formatVersions: "1"
			}:{
				method: encSettings.method,
				key: getKeyPromise(encSettings.key),
				iv: h2b(encSettings.iv || createIV(settings.sequenceNo)),
				format: format,
				formatVersions: encSettings.formatVersions
			}
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

		return segment;
	}

	return parse;
}());