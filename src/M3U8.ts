const linePat = /^(#)?(EXT)?(.+?)$/mg;
const attrSeparator = /(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/;

const keyPromises = new Map<string, Promise<ArrayBuffer>>();
function getKeyPromise(url: string){
  if(!keyPromises.has(url)){
    keyPromises.set(url, fetch(url).then(r => r.arrayBuffer()));
  }
  return keyPromises.get(url);
}

function validateString(s: string){
  if(!(s && s[0] === '"' && s[s.length-1] === '"')){ throw new Error("Expected Quoted String"); }
  s = s.substr(1,s.length-2);
  if(s.indexOf('"') !== -1){ throw new Error("Invalid Quoted String"); }
  return s;
}

function stripQuotes(s: string){
  return s.substr(1, s.length - 2);
}

function validateSignedFloat(s: string){
  const f = parseFloat(s);
  if(!isFinite(f)){ throw new Error("Invalid Float"); }
  return f;
}

function validateHex(s: string){
  return s;
}

function validateKeyFormats(s: string){
  return s;
}

function parseAttributes(line: string){
  const attrs = new Map<string, string>();
  for (const s of line.split(attrSeparator)) {
    if(s === '') continue;
    const p = s.split('=');
    attrs.set(p[0].trim(), p[1].trim());
  }
  return attrs;
}

type Settings = {
  renditions?: {
    AUDIO: {};
    VIDEO: {};
    SUBTITLES: {};
    'CLOSED-CAPTIONS': {};
  };
  list_type?: string;
  bandwidth?: any;
  avgBandwidth?: any;
  codecs?: any;
  video?: any;
  audio?: any;
  subtitles?: any;
  closedCaptions?: any;
  hasVersion: boolean;
  version?: number;
  hasSegments: boolean;
};

function * parseMaster(baseUrl: string, input: string){
  // TODO: Add default settings.
  linePat.lastIndex = 0;
  let match = linePat.exec(input);
  const settings: Settings = {
    renditions: {
      AUDIO: {},
      VIDEO: {},
      SUBTITLES: {},
      'CLOSED-CAPTIONS': {}
    },
    hasVersion: false,
    hasSegments: false,
  };

  // Clients SHOULD refuse to parse Playlists which contain a BOM,
  // but aren't required to. We'll be nice.
  if(input[0] === '\uFEFF'){ input = input.substr(1); }
  if(input.substr(0,7) !== "#EXTM3U"){ throw new Error("Missing EXTM3U tag."); }

  for(;match; match = linePat.exec(input)){
    if(match[1]){
      if(!match[2]){ continue; } //comment line
      parseMasterTag(match[3], settings, baseUrl);
    }else{ //Gotta be a URI line
      yield createVariant(baseUrl, match[0], settings);
    }
  }
}

function assert_master(settings: Settings){
  if(settings.list_type === "media"){
    throw new Error("Cannot use Master tags in Media Playlist");
  }else{ settings.list_type = "master"; }
}

function parseMasterTag(line: string, settings: Settings, baseUrl: string){
  let match: string[] | null;

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
  if(match){
    parseIndependentSegmentsTag(settings);
  }
  match = /-X-START:(.*)/.exec(line);
  if(match){
    parseStartTag(settings, parseAttributes(match[1]));
  }

}

function parseMediaType(rendition, attrs){
  switch(attrs.TYPE){
  case void 0:
    throw new Error("Media tag must have a 'TYPE' attribute.");
  case 'AUDIO':
  case 'VIDEO':
  case 'SUBTITLES':
  case 'CLOSED-CAPTIONS':
    rendition.type = attrs.TYPE;
    break;
  default:
    throw new Error(
      "Invalid type attribute in media tag: '"
      + attrs.TYPE + "' Valid types are 'AUDIO', "
      + "'VIDEO', 'SUBTITLES', and 'CLOSED-CAPTIONS'"
    );
  }
}

function parseMediaUriAttr(rendition, attrs){
  if(attrs.URI === void 0){
    if(attrs.TYPE === 'SUBTITLES'){
      throw new Error("Media tags of type 'SUBTITLES' must have a 'URI' attribute.");
    }
  }else{
    validateString(attrs.URI);
    if(attrs.TYPE === 'CLOSED-CAPTIONS'){
      throw new Error("Media tags of type 'CLOSED-CAPTIONS' must not have a 'URI' attribute.");
    }
    rendition.uri = stripQuotes(attrs.URI);
  }
}

function parseMediaGroupId(attrs){
  if(attrs['GROUP-ID'] === void 0){
    throw new Error("Media tag must have a 'GROUP-ID' attribute.");
  }
  validateString(attrs['GROUP-ID']);
  return stripQuotes(attrs['GROUP-ID']);
}

function parseMediaLanguage(rendition, attrs){
  if(attrs.LANGUAGE === void 0){ return; }
  validateString(attrs.LANGUAGE);
  rendition.language = stripQuotes(attrs.LANGUAGE);
}

function parseMediaAssocLanguage(rendition, attrs){
  if(attrs['ASSOC-LANGUAGE'] === void 0){ return; }
  validateString(attrs['ASSOC-LANGUAGE']);
  rendition.assocLanguage = stripQuotes(attrs['ASSOC-LANGUAGE']);
}

function parseMediaName(attrs){
  if(attrs.NAME === void 0){
    throw new Error("Media tag must have a 'NAME' attribute.");
  }
  validateString(attrs.NAME);
  return stripQuotes(attrs.NAME);
}

function parseMediaDefault(rendition, attrs){
  switch(attrs.DEFAULT){
  case void 0:
  case 'NO':
    rendition.default = false;
    break;
  case 'YES':
    rendition.default = true;
    break;
  default:
    throw new Error(
      "Invalid value for 'DEFAULT' attrbiute of media tag: '"
      + attrs.DEFAULT + "'. Valid values are 'YES' or 'NO'."
    );
  }
}

function parseMediaAutoSelect(rendition, attrs){
  switch(attrs.AUTOSELECT){
  case void 0:
    rendition.autoSelect = rendition.default;
  case 'NO':
    if(rendition.default){
      throw new Error(
        "Attribute 'AUTOSELECT' of media tag must have value 'YES' "
        + "if it exists and attribute 'DEFAULT' has a value of 'YES'."
      );
    }
    rendition.autoSelect = false;
    break;
  case 'YES':
    rendition.autoSelect = true;
    break;
  default:
    throw new Error(
      "Invalid value for 'AUTOSELECT' attrbiute of media tag: '"
      + attrs.AUTOSELECT + "'. Valid values are 'YES' or 'NO'."
    );
  }
}

function parseMediaForced(rendition, attrs){
  if(attrs.TYPE === 'SUBTITLES'){
    switch(attrs.FORCED){
    case void 0:
    case 'NO':
      rendition.forced = false;
      break;
    case 'YES':
      rendition.forced = true;
      break;
    default:
      throw new Error(
        "Invalid value for 'FORCED' attrbiute of media tag: '"
        + attrs.FORCED + "'. Valid values are 'YES' or 'NO'."
      );
    }
  }else if(attrs.FORCED !== void 0){
    throw new Error(
      "'FORCED' attribute of media tag may only"
      + " be present if 'TYPE' attribute has value of"
      + " 'SUBTITLES'."
    );
  }
}

function parseMediaInstreamId(rendition, attrs){
  var L21Number, DTCCNumber, instream;

  if(attrs.TYPE !== 'CLOSED-CAPTIONS'){
    if(attrs['INSTREAM-ID'] !== void 0){
      throw new Error(
        "'INSTREAM-ID' attribute of media tag may only"
        + " be present if 'TYPE' attribute has value of"
        + " 'CLOSED-CAPTIONS'."
      );
    }
  }else{

    if(attrs['INSTREAM-ID'] === void 0){
      throw new Error(
        "'INSTREAM-ID' attribute must be present"
        + " in media tag when 'TYPE' attribute is"
        + " 'CLOSED-CAPTIONS'."
      );
    }

    validateString(attrs['INSTREAM-ID']);

    instream = {};

    L21Number = /"CC([1-4])"/.exec(attrs['INSTREAM-ID'])[1];
    if(L21Number !== void 0){
      instream.type = 'CC';
      instream.channel = parseInt(L21Number, 10);
      rendition.instream = instream;
      return;
    }

    DTCCNumber = /"SERVICE([1-9]|[0-5]\d|6[0-3])"/.exec(attrs['INSTREAM-ID'])[1];
    if(DTCCNumber !== void 0){
      instream.type = 'SERVICE';
      instream.blockNumber = parseInt(DTCCNumber, 10);
      rendition.instream = instream;
      return;
    }

    throw new Error(
      "'INSTREAM-ID' attribute must be either"
      + " 'CC' followed by a number between 1 and 4,"
      + " or 'SERVICE' followed by a number between"
      + " 1 and 63."
    );
  }
}

function parseMediaCharacteristics(rendition, attrs){
  if(attrs.CHARACTERISTICS === void 0){ return; }
  validateString(attrs.CHARACTERISTICS);;
  rendition.characteristics =
    stripQuotes(attrs.CHARACTERISTICS)
    .split(/,\s*/);
}

function parseMediaTag(settings, attrs){
  assert_master(settings);

  var rendition = {},
    name = parseMediaName(attrs),
    groupId = parseMediaGroupId(attrs);

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

function parseStreamInfBandwidth(settings, attrs){
  if(attrs.BANDWIDTH === void 0){
    throw new Error("StreamInf tag must have 'BANDWIDTH' attribute");
  }
  settings.bandwidth = parseInt(attrs.BANDWIDTH);
}

function parseStreamInfAverageBandwidth(settings, attrs){
  if(attrs['AVERAGE-BANDWIDTH'] === void 0){ return; }
  settings.avgBandwidth = parseInt(attrs['AVERAGE-BANDWIDTH'], 10);
}

function parseStreamInfCodecs(settings, attrs){
  if(attrs.CODECS === void 0){ return; }
  validateString(attrs.CODECS);
  settings.codecs = stripQuotes(attrs.CODECS).split(',');
}

function parseStreamInfResolution(settings, attrs){
  if(attrs.RESOLUTION === void 0){ return; }

  var resArr = attrs.RESOLUTION.split('x'); 
  settings.resolution = {
    width: parseInt(resArr[0].trim(), 10),
    height: parseInt(resArr[1].trim(), 10)
  };
}

function parseStreamInfAudio(settings, attrs){
  if(attrs.AUDIO === void 0){ return; }
  validateString(attrs.AUDIO);

  var audioStr = stripQuotes(attrs.AUDIO),
    audio = settings.renditions[audioStr];
  if(!audio || audio.type !== 'AUDIO'){
    throw new Error(
      "'AUDIO' attribute in streamInf tag"
      + " must match the 'GROUP-ID' attribute of a"
      + " media tag of type 'AUDIO'"
    );
  }

  settings.audio = audio;
}

function parseStreamInfVideo(settings, attrs){
  if(attrs.VIDEO === void 0){ return; }
  validateString(attrs.VIDEO);

  var videoStr = stripQuotes(attrs.VIDEO),
    video = settings.renditions[videoStr];
  if(!video || video.type !== 'VIDEO'){
    throw new Error(
      "'VIDEO' attribute in streamInf tag"
      + " must match the 'GROUP-ID' attribute of a"
      + " media tag of type 'VIDEO'"
    );
  }

  settings.video = video;
}

function parseStreamInfSubtitles(settings, attrs){
  if(attrs.SUBTITLES === void 0){ return; }
  validateString(attrs.SUBTITLES);

  var subtitlesStr = stripQuotes(attrs.SUBTITLES),
    subs = settings.renditions[subtitlesStr];
  if(!subs || subs.type !== 'SUBTITLES'){
    throw new Error(
      "'SUBTITLES' attribute in streamInf tag"
      + " must match the 'GROUP-ID' attribute of a"
      + " media tag of type 'SUBTITLES'"
    );
  }

  settings.subtitles = subs;
}

function parseStreamInfClosedCaptions(settings, attrs){
  if(attrs['CLOSED-CAPTIONS'] === void 0){ return; }
  validateString(attrs['CLOSED-CAPTIONS']);

  var ccStr = stripQuotes(attrs['CLOSED-CAPTIONS']),
    cc = settings.renditions[ccStr] || undefined;
  if(!cc || cc.type !== 'CLOSED-CAPTIONS'){
    throw new Error(
      "'CLOSED-CAPTIONS' attribute in streamInf tag"
      + " must match the 'GROUP-ID' attribute of a"
      + " media tag of type 'CLOSED-CAPTIONS'."
    );
  }

  settings.closedCaptions = cc;
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
  var language, value, key;
  if(attrs['DATA-ID'] === void 0){
    throw new Error("Attribute 'DATA-ID' is required for Session Data tag.");
  }

  validateString(attrs['DATA-ID']);
  key = stripQuotes(attrs['DATA-ID']);

  if(attrs.VALUE !== void 0){
    validateString(attrs.VALUE);
    value = stripQuotes(attrs.VALUE);
    if(attrs['URI'] !== void 0){
      throw new Error("Session Data tag must not contain both VALUE and URI attributes.");
    }
  }else if(attrs['URI'] !== void 0){
    // Must point to JSON, but validating that require asynchrony
    validateString(attrs.URI);
    value = stripQuotes(attrs.URI);
  }

  if(attrs['LANGUAGE'] !== void 0){
    validateString(attrs.LANGUAGE);
    language = attrs.LANGUAGE;
  }

  settings.session[key] = {
    value: value,
    language: language
  };

}

function createVariant(baseUrl:string, line: string, settings: Settings){
  return {
    uri: resolveURL(baseUrl, line),
    bandwidth: settings.bandwidth,
    averageBandwidth: settings.avgBandwidth,
    codecs: settings.codecs,
    video: settings.video,
    audio: settings.audio,
    subtitles: settings.subtitles,
    closedCaptions: settings.closedCaptions,
  };
}

function parseMedia(baseUrl, input){
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

  // Clients SHOULD refuse to parse Playlists which contain a BOM,
  // but aren't required to. We'll be nice.
  if(input[0] === '\uFEFF'){ input = input.substr(1); }
  if(input.substr(0,7) !== "#EXTM3U"){ throw new Error("Missing EXTM3U tag."); }
  linePat.lastIndex = 7;
  match = linePat.exec(input);

  //Examine one line at a time
  for(;match; match = linePat.exec(input)){
    if(match[1]){
      if(!match[2]){ continue; } //comment line
      parseMediaTag(match[3], settings, baseUrl);
    }else{ //Gotta be a URI line
      segments.push(createSegment(baseUrl, match[0], settings));
    }
  }

  return {
    settings: settings,
    segments: Promise.all(segments)
  };
}

function assert_media(settings: Settings){
  if(settings.list_type === "master"){
    throw new Error("Cannot use Media Segment tags in Master Playlist");
  }else{ settings.list_type = "media"; }
}

function parseMediaTag(line: string, settings: Settings, baseUrl: string){
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

function parseVersionTag(settings: Settings, num: string){
  if(settings.hasVersion){ throw new Error("Duplicate X-VERSION tags."); }
  if(settings.hasSegments){ throw new Error("X-VERSION tag must preceded media segments."); }
  settings.hasVersion = true;
  settings.version = parseInt(num,10);
}

function parseTargetDurationTag(settings: Settings, num: string){
  assert_media(settings);
  if(settings.hasTargetDuration){ throw new Error("Duplicate X-TARGETDURATION tags."); }
  if(settings.hasSegments){ throw new Error("X-TARGETDURATION tag must preceded media segments."); }
  settings.hasTargetDuration = true;
  settings.targetDuration = parseInt(num,10);
}

function parseMediaSequenceTag(settings: Settings, num: string){
  assert_media(settings);
  if(settings.hasSequenceNo){ throw new Error("Duplicate X-MEDIA-SEQUENCE tags."); }
  if(settings.hasSegments){ throw new Error("X-MEDIA-SEQUENCE tag must preceded media segments."); }
  settings.hasSequenceNo = true;
  settings.sequenceNo = parseInt(num,10);
}

function parseDiscontinuitySequenceTag(settings: Settings, num: string){
  assert_media(settings);
  if(settings.hasDiscontinuitySequence){ throw new Error("Duplicate X-DISCONTINUITY-SEQUENCE tags."); }
  if(settings.hasSegments){ throw new Error("X-DISCONTINUITY-SEQUENCE tag must preceded media segments."); }
  if(settings.mutability !== ""){ throw new Error("EVENT or VOD playlist may not contain X-DISCONTINUITY-SEQUENCE tag."); }
  settings.hasDiscontinuitySequence = true;
  settings.discontinuitySequence = parseInt(num,10);
}

function parsePlaylistTypeTag(settings: Settings, type: string){
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

function parseEndlistTag(settings: Settings){
  assert_media(settings);
  if(settings.isFinished){
    throw new Error("Duplicate X-ENDLIST tags.");
  }
  settings.isFinished = true;
}

/*
function parseIFrameTag(settings){
  assert_media(settings);
  //http://tools.ietf.org/html/draft-pantos-http-live-streaming-14#section-4.3.3.6
  throw new Error("X-I-FRAMES-ONLY tag not supported.");
}
*/

function parseInfTag(settings: Settings, match: string[]){
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

function parseByterangeTag(settings: Settings, match: string[]){
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

function parseDiscontinuityTag(settings: Settings){
  assert_media(settings);
  settings.discontinuitySequence++;
}

function parseMapTag(settings: Settings, _: Map<string, string>){
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

function parseDateTimeTag(settings: Settings, _: string){
  assert_media(settings);
  throw new Error("X-PROGRAM-DATE-TIME tag not supported.");
  //http://tools.ietf.org/html/draft-pantos-http-live-streaming-14#section-4.3.2.6
  //settings.dateTime = validateDateTime(date);
}

function parseKeyTag(settings: Settings, attrs: Map<string, string>, baseUrl: string){
  /* It applies to every Media Segment that appears between
    * it and the next EXT-X-KEY tag in the Playlist file with the same
    * KEYFORMAT attribute (or the end of the Playlist file).
    * TODO: Set up a map of KeyFormats
    */
  assert_media(settings);
  switch(attrs.get('METHOD')){
  case void 0:
    throw new Error("METHOD attribute missing from X-KEY tag.");
  case "NONE":
    if(Object.keys(attrs).length > 1){
      throw new Error("Additional attributes disallowed for encryption method NONE.");
    }
    settings.encryption.format = "identity";
    settings.encryption.formatSettings.identity = {
      method: "NONE",
      key: "", iv: "",
      formatVersions: ""
    };
    return;
  case "AES-128": {
    if(!attrs.has('URI')){ throw new Error("Missing Encryption Key URI."); }
    const keyStr = validateString(attrs.get('URI'));
    const key = resolveURL(baseUrl, keyStr);

    let iv: string;
    if(!attrs.has('IV')){
      iv = "";
    }else if(settings.version < 2){
      throw new Error("IV attribute requires version 2 or greater.");
    }else{
      iv = validateHex(attrs.get('IV'));
    }

    let format: string;
    if(!attrs.has('KEYFORMAT')){
      format = "identity";
    }else if(settings.version < 5){
      throw new Error("KEYFORMAT attribute requires version 5 of greater.");
    }else{
      format = validateString(attrs.get('KEYFORMAT'));
    }

    let versions: string;
    if(!attrs.has('KEYFORMATVERSIONS')){
      versions = "1";
    }else if(settings.version < 5){
      throw new Error("KEYFORMATVERSIONS attribute requires version 5 of greater.");
    }else{
      versions = validateKeyFormats(attrs.get('KEYFORMATVERSIONS'));
    }

    settings.encryption.format = format;
    settings.encryption.formatSettings[format] = {
      method: "AES-128",
      key, iv,
      formatVersions: versions
    };
    break;
  }
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

function createIV(num: number){
  const zeros = "00000000000000000000000000000000";
  const hex = num.toString(16);
  return zeros.substr(hex.length)+hex;
}

function h2b(s: string) {
  const l = s.length;
  const b = new Uint8Array(Math.floor(l/2));
  for(let i = 0; i < l; i+=2){
    b[i/2] = parseInt(s.substr(i,2),16);
  }
  return b.buffer;
}

function createSegment(baseUrl: string, line: string, settings){
  const format = settings.encryption.format;
  const encSettings = settings.encryption.formatSettings[format];

  const segment = {
    uri: resolveURL(baseUrl, line),
    seqNo: settings.sequenceNo,
    discSeqNo: settings.discontinuitySequence,
    duration: settings.duration,
    isRange: false,
    offset: 0,
    byteLen: 0,
    encryption: null
  };

  settings.sequenceNo++;

  if(settings.hasRange){
    settings.hasRange = false;
    if(!settings.hasOffset && line !== settings.lastByteRange){
      throw new Error("Missing byte range offset");
    }
    segment.isRange = true;
    segment.offset = settings.offset;
    segment.byteLen = settings.rangelen;
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

const head = document.getElementsByTagName('head')[0];
const base = document.createElement('base');
const resolver = document.createElement('a');

// relative URL resolver
function resolveURL(base_url: string, url: string) {
  head.appendChild(base);
  base.href = base_url;
  resolver.href = url;
  // browser magic at work here
  const resolved_url  = resolver.href;
  head.removeChild(base);
  return resolved_url;
}

async function getManifest(url: string) {
  return (await fetch(url)).text();
}

class M3U8Manifest {
  public segments = [];
  private listeners = [];

  constructor (public url: string, public text?: string) {
    if(text){ this.update(text); }
    else{ this.reload(); }
  }

  async update(text: string) {
    const obj = parseMedia(this.url, text);
    const segments = await obj.segments;
    //var settings = obj.settings,
    //  waitFraction = 1000;

    // TODO: compare with previous segment list
    // to generate diffs & determine the proper wait time
    this.segments = segments;

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

    // Turn this on once the player is updated
    // to handle changes in the manifest
    /*if(settings.mutability !== "VOD" &&
      !(settings.mutability === "EVENT" && settings.isFinished)){
      setTimeout(
        function(){ that.reload(); },
        settings.targetDuration*waitFraction
      );
    }*/

    this.emit(segments);
  }

  async reload(){
    this.update(await getManifest(this.url));
  }

  emit(segments: any[]){
    for (const cb of this.listeners)
      setTimeout(cb.bind(null, segments), 0);
  }

  listen(cb: (s: any[]) => void) {
    this.listeners.push(cb);
  }

  unlisten(cb: (s: any[]) => void) {
    const idx = this.listeners.indexOf(cb);
    if(~idx){ this.listeners.splice(idx,1); }
  }
}

function isMaster(text: string){
  return !~text.indexOf('EXTINF');
}

function * manifestsFromMaster(url: string, text: string){
  for (const variant of parseMaster(url, text))
    yield new M3U8Manifest(variant.uri);
}

export async function fetchHLSManifests(url: string){
  const text = await getManifest(url);
  return isMaster(text) ?
    manifestsFromMaster(url, text) :
    [new M3U8Manifest(url, text)];
}
