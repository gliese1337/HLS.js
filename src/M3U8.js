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

	function parseMaster(baseUrl, input){
		// TODO: Add default settings.
		var match = linePat.exec(input),
			variants = [],
			settings = {
				renditions: {
					AUDIO: {},
					VIDEO: {},
					SUBTITLES: {},
					'CLOSED-CAPTIONS': {},
				},
			};

		//Clients SHOULD refuse to parse Playlists which contain a BOM
		if(input[0] === '\uFEFF'){ throw new Error("BOM detected"); }
		if(input.substr(0,7) !== "#EXTM3U"){ throw new Error("Missing EXTM3U tag."); }
		
		
		for(;match; match = linePat.exec(input)){
			if(match[1]){
				if(!match[2]){ continue; } //comment line
				parseTagMaster(match[3], settings, baseUrl);
			}else{ //Gotta be a URI line
				var variant = createVariant(baseUrl, match[0], settings);
				variants.push(variant);
			}
		}

		return {
			settings: settings,
			variants: variants
		};
	}

	function assert_master(settings){
		if(settings.list_type === "media"){
			throw new Error("Cannot use Master tags in Media Playlist");
		}else{ settings.list_type = "master"; }
	}

	function assert_quotedString(str) {
		var lastIndex = str.length - 1;
		if(str[0] !== '"' || str[lastIndex] !== '"') {
			var msg = "'URI' attribute of a media tag must"
				+ " start and end with '\"'";
			throw new Error(msg);
		}
	}

	function stripQuotes(str) {
		var lastIndex = str.length - 1;
		return str.substr(1, lastIndex - 1);
	}

	function parseTagMaster(line, settings, baseUrl) {
		var match;

		//Basic Tags
		match = /-X-VERSION:(\d+)/.exec(line);
		if(match){
			parseVersionTag(settings, match[1]);
			return;
		}

		//Master Playlist Tags
		match = /-X-MEDIA:(.*)/.exec(line);
		if(match){
			parseMediaTag(settings, parseAttributes(match[1]));
			return;
		}
		match = /-X-STREAM-INF:(.*)/.exec(line);
		if(match){
			parseStreamInfTag(settings, parseAttributes(match[1]));
			return;
		}
		match = /-X-I-FRAME-STREAM-INF:(.*)/.exec(line);
		if(match){
			parseIFrameStreamTag(settings, parseAttributes(match[1]), baseUrl);
			return;
		}
		match = /-X-SESSION-DATA:(.*)/.exec(line);
		if(match){
			parseSessionDataTag(settings, parseAttributes(match[1]));
			return;
		}

		//Media or Master Playlist tags
		match = /-X-INDEPENDENT-SEGMENTS/.exec(line);
		if(match) {
			parseIndependentSegmentsTag(settings);
		}
		match = /-X-START:(.*)/.exec(line);
		if(match) {
			parseStartTag(settings, parseAttributes(match[1]));
		}

	}

	function parseMediaType(rendition, attrs) {
		switch(attrs.TYPE) {
		case void 0:
			throw new Error("Media tag must have a 'TYPE' attribute.");
			break;
		case 'AUDIO':
			rendition.type = 'audio';
			break;
		case 'VIDEO':
			rendition.type = 'VIDEO'
			break;
		case 'SUBTITLES':
			rendition.type = 'SUBTITLES';
			break;
		case 'CLOSED-CAPTIONS':
			rendition.type = 'CLOSED-CAPTIONS';
			break;
		default:
			var msg = "Invalid type attribute in media tag: '"
				+ attrs.TYPE + "' Valid types are 'AUDIO', "
				+ "'VIDEO', 'SUBTITLES', and 'CLOSED-CAPTIONS'";
			throw new Error(msg);
		}
	}

	function parseMediaUriAttr(rendition, attrs) {
		if(typeof attrs.URI === 'undefined') {
			if(typeof attrs.TYPE !== undefined) {
				if(attrs.TYPE === 'SUBTITLES') {
					var msg = "Media tags of type 'SUBTITLES' must have a 'URI' attribute.";
					throw new Error(msg);
				}
			}
		}
		else {
			assert_quotedString(attrs.URI);
			if(attrs.TYPE) {
				if(attrs.TYPE === 'CLOSED-CAPTIONS') {
					var msg = "Media tags of type 'CLOSED-CAPTIONS' must not"
						+ " have a 'URI' attribute.";
					throw new Error(msg);
				}
			}
			rendition.uri = stripQuotes(attrs.URI);
		}
	}

	function parseMediaGroupId(attrs) {
		if(typeof attrs['GROUP-ID'] === 'undefined') {
			throw new Error("Media tag must have a 'GROUP-ID' attribute.");
		}
		else {
			assert_quotedString(attrs['GROUP-ID']);
			console.log(attrs['GROUP-ID']);
			return stripQuotes(attrs['GROUP-ID']);
		}
	}

	function parseMediaLanguage(rendition, attrs) {
		if(typeof attrs.LANGUAGE !== 'undefined') {
			assert_quotedString(attrs.LANGUAGE);
			rendition.language = stripQuotes(attrs.LANGUAGE);
		}
	}

	function parseMediaAssocLanguage(rendition, attrs) {
		if(typeof attrs['ASSOC-LANGUAGE'] !== 'undefined') {
			rendition.assocLanguage = stripQuotes(attrs['ASSOC-LANGUAGE']);
		}
	}

	function parseMediaName(attrs) {
		if(typeof attrs.NAME === 'undefined') {
			throw new Error("Media tag must have a 'NAME' attribute.");
		} else {
			assert_quotedString(attrs.NAME);
			return stripQuotes(attrs.NAME);
		}
	}

	function parseMediaDefault(rendition, attrs) {
		switch(attrs.DEFAULT) {
		case void 0, 'NO':
			rendition.default = false;
			break;
		case 'YES':
			rendition.default = true;
			break;
		default:
			var msg = "Attribute 'DEFAULT' of media tag must be 'YES'"
				+ " or 'NO'. Value was '" + attrs.DEFAULT + "'.";
			throw new Error(msg);
		}
	}

	function parseMediaAutoSelect(rendition, attrs) {
		switch(attrs.AUTOSELECT) {
		case void 0, 'NO':
			if(rendition.default) {
				var msg = "Attribute 'AUTOSELECT' must have value 'YES'"
					+ " if it exists and attribute 'DEFAULT' has a value"
					+ " of 'YES'."
			}
			else {
				rendition.autoSelect = false;
			}
			break;
		case 'YES':
			rendition.autoSelect = true;
			break;
		default:
			var msg = "Attribute 'AUTOSELECT' of media tag must be"
				+ "'YES' or 'NO'. Value was '" + attrs.DEFAULT + "'.";
			throw new Error(msg);
		}
	}

	function parseMediaForced(rendition, attrs) {
		if(attrs.TYPE === 'SUBTITLES') {
			switch(attrs.FORCED) {
			case void 0, 'NO':
				rendition.forced = false;
				break;
			case 'YES':
				rendition.forced = true;
				break;
			default:
				var msg = "Attribute 'FORCED' of media tag must be"
					+ "'YES' or 'NO'. Value was '" + attrs.DEFAULT + "'.";
				throw new Error(msg);
			}
		} else if(typeof attrs.FORCED !== 'undefined') {
			var msg = "'FORCED' attribute of media tag may only"
				+ " be present if 'TYPE' attribute has value of"
				+ " 'SUBTITLES'.";
			throw new Error(msg);
		}
	}

	function parseMediaInstreamId(rendition, attrs) {
		if(attrs.TYPE === 'CLOSED-CAPTIONS') {
			assert_quotedString(attrs['INSTREAM-ID']);
			if(typeof attrs['INSTREAM-ID'] === 'undefined') {
				var msg = "'INSTREAM-ID' attribute must be present"
					+ " in media tag when 'TYPE' attribute is"
					+ " 'CLOSED-CAPTIONS'.";
				throw new Error(msg);
			}
			var L21RegExp = /"CC([1-4])"/;
			var L21Number = L21RegExp.exec(attrs['INSTREAM-ID'])[1];
			var DTCCRegExp = /"SERVICE([1-9]|[0-5]\d|6[0-3])"/;
			var DTCCNumber = DTCCRegExp.exec(attrs['INSTREAM-ID'])[1];
			var instream = {};
			if(typeof L21Number !== 'undefined') {
				instream.type = 'CC';
				instream.channel = parseInt(L21Number);
				rendition.instream = instream;
			} else if(typeof DTCCNumber !== 'undefined') {
				instream.type = 'SERVICE';
				instream.blockNumber = DTCCNumber;
				rendition.instream = instream;
			} else {
				var msg = "'INSTREAM-ID' attribute must be either"
					+ " 'CC' followed by a number between 1 and 4,"
					+ " or 'SERVICE' followed by a number between"
					+ " 1 and 63.";
				throw new Error(msg);
			}
		} else if(typeof attrs['INSTREAM-ID'] !== 'undefined') {
			var msg = "'INSTREAM-ID' attribute of media tag may only"
				+ " be present if 'TYPE' attribute has value of"
				+ " 'CLOSED-CAPTIONS'.";
			throw new Error(msg);
		}
	}

	function parseMediaCharacteristics(rendition, attrs) {
		if(typeof attrs.CHARACTERISTICS !== 'undefined') {
			assert_quotedString(attrs.CHARACTERISTICS);
			var quoteless = stripQuotes(attrs.CHARACTERISTICS);
			var characteristics = quoteless.split(/,\s*/);
			rendition.characteristics = characteristics;
		}
	}

	function parseMediaTag(settings, attrs){
		assert_master(settings);

		var rendition = {};
		var name = parseMediaName(attrs);
		var groupId = parseMediaGroupId(attrs);

		parseMediaType(rendition, attrs);
		parseMediaUri(rendition, attrs);
		parseMediaLanguage(rendition, attrs);
		parseMediaAssocLanguage(rendition, attrs);
		parseMediaDefault(rendition, attrs);
		parseMediaAutoSelect(rendition, attrs);
		parseMediaForced(rendition, attrs);
		parseMediaInstreamId(rendition, attrs);
		parseMediaCharacteristics(rendition, attrs);
				
		settings.groups[groupId] = settings.groups[groupId] || {};
		settings.groups[groupId][name] = rendition;
	}

	function parseStreamInfBandwidth(settings, attrs) {
		if(attrs.BANDWIDTH) {
			settings.bandwidth = parseInt(attrs.BANDWIDTH);
		}
		else {
			var msg = "StreamInf tab must have"
				+ " 'BANDWIDTH' attribute";
			throw new Error(msg);
		}
	}

	function parseStreamInfAverageBandwidth(settings, attrs) {
		if(attrs['AVERAGE-BANDWIDTH']) {
			settings.avgBandwidth = parseInt(attrs['AVERAGE-BANDWIDTH']);
		}
	}

	function parseStreamInfCodecs(settings, attrs) {
		if(attrs.CODECS) {
			assert_quotedString(attrs.CODECS);
			var codecsStr = stripQuotes(attrs.CODECS);
			settings.codecs = codecsStr.split(',');
		}
	}

	function parseStreamInfResolution(settings, attrs) {
		if(attrs.RESOLUTION){
			var resArr = attrs.RESOLUTION.split('x');
			var resolution = {
				width: resArr[0],
				height: resArr[0],
			}
			settings.resolution = resolution;
		}
	}

	function parseStreamInfAudio(settings, attrs) {
		if(attrs.AUDIO) {
			assert_quotedString(attrs.AUDIO);
			var audioStr = stripQuotes(attrs.AUDIO);
			var audio = settings.renditions[audioStr] || undefined;
			if(!audio || audio.type !== 'AUDIO') {
				var msg = "'AUDIO' attribute in streamInf tag"
				+ " must match the 'GROUP-ID' attribute of a"
				+ " media tag of type 'AUDIO'";
			} else {
				settings.audio = audio;
			}
		}
	}

	function parseStreamInfVideo(settings, attrs) {
		if(attrs.VIDEO) {
			assert_quotedString(attrs.VIDEO);
			var videoStr = stripQuotes(attrs.VIDEO);
			var video = settings.renditions[videoStr] || undefined;
			if(!video || video.type !== 'VIDEO') {
				var msg = "'VIDEO' attribute in streamInf tag"
				+ " must match the 'GROUP-ID' attribute of a"
				+ " media tag of type 'VIDEO'";
			} else {
				settings.video = video;
			}
		}
	}

	function parseStreamInfSubtitles(settings, attrs) {
		if(attrs.SUBTITLES) {
			assert_quotedString(attrs.SUBTITLES);
			var subtitlesStr = stripQuotes(attrs.SUBTITLES);
			var subs = settings.renditions[subtitlesStr] || undefined;
			if(!subs || subs.type !== 'SUBTITLES') {
				var msg = "'SUBTITLES' attribute in streamInf tag"
				+ " must match the 'GROUP-ID' attribute of a"
				+ " media tag of type 'SUBTITLES'";
			} else {
				settings.subtitles = subs;
			}
		}
	}

	function parseStreamInfClosedCaptions(settings, attrs) {
		if(attrs['CLOSED-CAPTIONS']) {
			assert_quotedString(attrs['CLOSED-CAPTIONS']);
			var ccStr = stripQuotes(attrs['CLOSED-CAPTIONS']);
			var cc = settings.renditions[ccStr] || undefined;
			if(!cc || cc.type !== 'CLOSED-CAPTIONS') {
				var msg = "'CLOSED-CAPTIONS' attribute in streamInf tag"
				+ " must match the 'GROUP-ID' attribute of a"
				+ " media tag of type 'CLOSED-CAPTIONS'.";
			} else {
				settings.closedCaptions = cc;
			}
		}
	}

	function parseStreamInfTag(settings, attrs){
		assert_master(settings);

		parseStreamInfBandwidth(settings, attrs);
		parseStreamInfAverageBandwidth(settings, attrs);
		parseStreamInfCodecs(settings, attrs);
		parseStreamInfResolution(settings, attrs);
		parseStreamInfAudio(settings, attrs);
		parseStreamInfVideo(settings, attrs);
		parseStreamInfSubtitles(settings, attrs);
		parseStreamInfClosedCaptions(settings, attrs);
	}

	function parseIFrameStreamTag(settings, attrs, baseUrl){
		assert_master(settings);

		parseStreamInfBandwidth(settings);
		parseStreamInfAverageBandwidth(settings, attrs);
		parseStreamInfCodecs(settings, attrs);
		parseStreamInfResolution(settings, attrs);
		parseStreamInfVideo(settings, attrs);
		parseIFrameStreamUri(settings, attrs, baseUrl);

		createVariant(baseUrl, attrs.URI, settings);
	}

	function parseSessionDataTag(settings, attrs){
		assert_quotedString(attrs['DATA-ID']);
		var key = stripQuotes(attrs['DATA-ID']);
		var value;
		if(attrs['VALUE']) {
			value = stripQuotes(attrs['VALUE']);
		} else if(attrs['URI']) {
			value = getJSONFromUrl(attrs['URI']);
		}
		settings.session[key] = {};
		settings.session[key].value = value;
		if(attrs['LANGUAGE']) {
			var language = parseLanguage(attrs.LANGUAGE);
			settings.session[key].language = language;
		}
	}

	function createVariant(baseUrl, line, settings) {

		var variant = {
			uri: resolveURL(baseUrl, line),
			bandwidth: settings.bandwidth,
			averageBandwidth: settings.avgBandwidth,
			codecs: settings.codecs,
			video: settings.video,
			audio: settings.audio,
			subtitles: settings.subtitles,
			closedCaptions: settings.closedCaptions,
		}

		return variant;
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
				parseTag(match[3], settings, baseUrl);
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

	function parseTag(line,settings,baseUrl){
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
			parseKeyTag(settings, parseAttributes(match[1]), baseUrl);
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

	function parseKeyTag(settings,attrs,baseUrl){
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
			var keyStr = validateString(attrs.URI);
			key = resolveURL(baseUrl, keyStr);

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

	function M3U8Master(text, url) {
		var parsed = parseMaster(url, text);
		this.settings = parsed.settings;
		this.variants = parsed.variants;
	}

	function isMaster(text){
		return !~text.indexOf('EXTINF');
	}

	function manifestsFromMaster(text, url){
		var masterPlaylist = new M3U8Master(text, url);
		var manifests = [];
		var variants = masterPlaylist.variants;
		for(var i = 0; i < variants.length; i++) {
			var variant = variants[i];
			var mediaUrl = variant.uri;
			var text = getManifest(mediaUrl);
			var manifest = new M3U8Manifest(text, mediaUrl);
			manifests.push(manifest);
		}
		return manifests;
	}

	function fetchHLSManifests(url){
		return getManifest(url).then(function(text) {
			if(isMaster(text)) {
				return manifestsFromMaster(text, url);
			}
			else {
				return Promise.resolve([new M3U8Manifest(text, url)]);
			}
		});
	}

	return fetchHLSManifests;
}());