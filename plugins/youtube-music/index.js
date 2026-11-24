// Single-file ES module for Lekis QuickJS. No Node/browser dependencies.
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;

function desktop() {
  if (host.app.platform === 'ios') throw new PluginError('unsupported', '当前 iOS 版暂不支持此 YouTube Music 插件。');
  if (host.app.platform === 'android') throw new PluginError('unsupported', 'Android 需要使用插件的本地解析入口。');
}

async function android(operation, params) {
  if (!host.native || host.native.available !== true || typeof host.native.call !== 'function') {
    throw new PluginError('setup', '请使用支持本地插件的 Android 版 Lekis，并在插件设置中允许本地解析代码。');
  }
  return await host.native.call(operation, params);
}

// Keep explicit video requests separate from keyword discovery on both runtimes.
function directRequest(query) {
  if (VIDEO_ID.test(query)) return { explicit: true, id: query };
  const explicit = /^(?:https?:\/\/|(?:www\.|music\.|m\.)?(?:youtube\.com|youtu\.be)\/)/i.test(query);
  if (!explicit) return { explicit: false };
  const normalized = query.replace(/^http:\/\//i, 'https://').replace(/^(?!(?:https?):\/\/)/i, 'https://');
  const link = /^https:\/\/(?:(?:(?:music\.|www\.|m\.)?youtube\.com)(?::443)?\/(?:watch\?([^#]*)|(?:shorts|embed|live)\/([A-Za-z0-9_-]{11})(?:[?#].*)?)|youtu\.be(?::443)?\/([A-Za-z0-9_-]{11})(?:[?#].*)?)$/i.exec(normalized);
  let id = link && (link[2] || link[3]);
  if (link && link[1]) {
    const value = /(?:^|&)v=([^&]*)/.exec(link[1]);
    try { id = value && decodeURIComponent(value[1]); } catch (_) { id = null; }
  }
  return { explicit: true, id: VIDEO_ID.test(id || '') ? id : null };
}

// Album links are handled before video URLs: a watch URL with a video ID
// still means that exact video, even if it also carries a playlist ID.
function directAlbum(query) {
  const normalized = query.replace(/^http:\/\//i, 'https://').replace(/^(?!(?:https?):\/\/)/i, 'https://');
  const match = /^https:\/\/(?:music\.|www\.)?youtube\.com(?::443)?\/(?:browse\/(MPREb_[A-Za-z0-9_-]+)(?:\?[^#]*)?|playlist\?([^#]*))(?:#.*)?$/i.exec(normalized);
  if (!match) return null;
  if (match[1]) return match[1];
  const value = /(?:^|&)list=([^&]*)/.exec(match[2] || '');
  let id; try { id = value && decodeURIComponent(value[1]); } catch (_) { return null; }
  return /^OLAK5uy_[A-Za-z0-9_-]+$/.test(id || '') ? 'VL' + id : null;
}

function textRuns(value) {
  return (value?.runs || []).map(run => run.text || '').join('').trim() || value?.simpleText || '';
}

function findNamed(node, key, out = []) {
  if (!node || typeof node !== 'object') return out;
  if (Array.isArray(node)) { for (const child of node) findNamed(child, key, out); return out; }
  if (node[key]) out.push(node[key]);
  for (const value of Object.values(node)) if (value && typeof value === 'object') findNamed(value, key, out);
  return out;
}

function albumPage(data, limit) {
  const header = findNamed(data?.header, 'musicDetailHeaderRenderer')[0]
    || findNamed(data?.header, 'musicResponsiveHeaderRenderer')[0];
  const album = textRuns(header?.title);
  const items = [], seen = new Set();
  // Only album shelf rows are songs; never promote recommendations or menus.
  for (const shelf of findNamed(data?.contents, 'musicShelfRenderer')) {
    for (const item of shelf.contents || []) {
      const row = item.musicResponsiveListItemRenderer;
      if (!row) continue;
      const id = row.playlistItemData?.videoId || findNamed(row.flexColumns?.[0], 'watchEndpoint')[0]?.videoId;
      const title = textRuns(row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
      if (!VIDEO_ID.test(id || '') || !title || seen.has(id)) continue;
      const runs = row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artists = runs.filter(run => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST').map(run => run.text).filter(Boolean);
      const fixed = textRuns(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
      const duration = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(fixed);
      items.push({id, title, artists: artists.length ? artists : ['YouTube Music'], album: album || undefined,
        durationMs: duration ? ((Number(duration[1] || 0) * 3600 + Number(duration[2]) * 60 + Number(duration[3])) * 1000) : 0,
        artworkUrl: 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'});
      seen.add(id);
      if (items.length >= limit) return items;
    }
  }
  return items;
}

async function albumTracks(browseId, limit) {
  let page;
  try { page = await host.http.get('https://music.youtube.com/', {timeoutMs:5000}); }
  catch (_) { throw new PluginError('unavailable', '无法连接 YouTube Music 专辑目录，请检查网络。'); }
  if (page.status !== 200) throw new PluginError('unavailable', 'YouTube Music 专辑目录当前不可用。');
  const html = await page.text();
  const version = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([0-9.]+)"/.exec(html)?.[1];
  if (!version) throw new PluginError('unavailable', 'YouTube Music 专辑目录当前不可用，可能受地区或网络限制。');
  let response;
  try {
    response = await host.http.request('https://music.youtube.com/youtubei/v1/browse', {
      method:'POST', timeoutMs:8000, headers:{'Content-Type':'application/json'},
      body:JSON.stringify({context:{client:{clientName:'WEB_REMIX',clientVersion:version}}, browseId}),
    });
  } catch (_) { throw new PluginError('unavailable', '无法读取此 YouTube Music 专辑，请检查网络。'); }
  if (response.status === 429) throw new PluginError('rateLimited', 'YouTube 请求过多，请稍后再试。');
  if (response.status !== 200) throw new PluginError('unavailable', '此专辑当前不可用或未在本地区开放。');
  const items = albumPage(await response.json(), limit);
  if (!items.length) throw new PluginError('unavailable', '此专辑没有可读取的歌曲，或当前地区不可用。');
  return items;
}

export async function browse({path, cursor}) {
  if (cursor) throw new PluginError('unsupported', '此专辑暂不支持分页。');
  if (!path) return {items:[]};
  const id = /^album:(MPREb_[A-Za-z0-9_-]+|VLOLAK5uy_[A-Za-z0-9_-]+)$/.exec(path)?.[1];
  if (!id) throw new PluginError('unsupported', '专辑路径无效。');
  return {items:(await albumTracks(id, 50)).map(item => ({...item, kind:'track'}))};
}

function exactTrack(page, id) {
  if (!page || !Array.isArray(page.items) || page.items.length !== 1 || page.items[0]?.id !== id) {
    throw new PluginError('unavailable', '指定的 YouTube 视频不可用；未改为搜索其他视频。');
  }
  return { ...page, searchMode: 'direct-id' };
}

// Search the public Music catalog first, then the public YouTube results page.
function searchDuration(text) {
  const match = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(text || '');
  return match ? (Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000 : 0;
}

function musicSearchItems(data, limit) {
  const items = [], seen = new Set();
  for (const shelf of findNamed(data?.contents, 'musicShelfRenderer')) {
    for (const item of shelf.contents || []) {
      const row = item.musicResponsiveListItemRenderer;
      if (!row) continue;
      const id = row.playlistItemData?.videoId || findNamed(row.flexColumns?.[0], 'watchEndpoint')[0]?.videoId;
      const title = textRuns(row.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text);
      if (!VIDEO_ID.test(id || '') || !title || seen.has(id)) continue;
      const runs = row.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [];
      const artists = runs.filter(run => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ARTIST').map(run => run.text).filter(Boolean);
      const album = runs.find(run => run.navigationEndpoint?.browseEndpoint?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_ALBUM')?.text;
      const durationText = runs.map(run => run.text).find(value => searchDuration(value)) || textRuns(row.fixedColumns?.[0]?.musicResponsiveListItemFixedColumnRenderer?.text);
      items.push({id, title, artists: artists.length ? artists : ['YouTube Music'], album: album || undefined,
        durationMs: searchDuration(durationText), artworkUrl:'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'});
      seen.add(id);
      if (items.length >= limit) return items;
    }
  }
  return items;
}

async function desktopSearch(query, limit) {
  desktop();
  let rateLimited = false;
  try {
    const page = await host.http.get('https://music.youtube.com/', {timeoutMs:5000});
    if (page.status === 429) rateLimited = true;
    if (page.status === 200) {
      const html = await page.text();
      const version = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([0-9.]+)"/.exec(html)?.[1];
      if (version) {
        const response = await host.http.request('https://music.youtube.com/youtubei/v1/search', {
          method:'POST', timeoutMs:8000, headers:{'Content-Type':'application/json'},
          body:JSON.stringify({context:{client:{clientName:'WEB_REMIX', clientVersion:version}}, query,
            params:'EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D'}),
        });
        if (response.status === 429) rateLimited = true;
        if (response.status === 200) {
          const items = musicSearchItems(await response.json(), limit);
          if (items.length) return {items};
        }
      }
    }
  } catch (_) { /* Try the public YouTube search page below. */ }
  try {
    const page = await host.http.get('https://www.youtube.com/results?search_query=' + encodeURIComponent(query), {timeoutMs:8000});
    if (page.status === 429) rateLimited = true;
    if (page.status === 200) {
      const html = await page.text();
      const match = /(?:var\s+ytInitialData\s*=\s*|ytInitialData"\s*:\s*)(\{.+?\})\s*;\s*<\/script>/s.exec(html);
      if (match) {
        const data = JSON.parse(match[1]);
        const items = [], seen = new Set();
        for (const video of findNamed(data?.contents, 'videoRenderer')) {
          const id = video.videoId, title = textRuns(video.title);
          if (!VIDEO_ID.test(id || '') || !title || seen.has(id) || !video.lengthText) continue;
          const artist = textRuns(video.ownerText) || textRuns(video.shortBylineText) || 'YouTube';
          items.push({id, title, artists:[artist], durationMs:searchDuration(textRuns(video.lengthText)),
            artworkUrl:'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'});
          seen.add(id);
          if (items.length >= limit) break;
        }
        return {items, searchMode:'youtube-audio-fallback'};
      }
    }
  } catch (_) { /* Report a single useful error after both services fail. */ }
  if (rateLimited) throw new PluginError('rateLimited', 'YouTube 请求过多，请稍后再试。');
  throw new PluginError('unavailable', '无法搜索 YouTube Music，请检查网络或稍后重试。');
}

export async function search(params) {
  if (params.type !== 'track') throw new PluginError('unsupported', '此插件支持搜索歌曲。');
  const query = String(params.query || '').replace(/[\u200B-\u200D\uFEFF]/g, '').trim();
  if (!query) return { items: [] };
  if (params.cursor) throw new PluginError('unsupported', '请使用更精确的关键词搜索。');
  const configured = Number(host.setting('searchLimit')) || 25;
  const limit = Math.max(1, Math.min(50, configured, Number(params.limit) || configured));
  const albumId = directAlbum(query);
  if (albumId) return {items: await albumTracks(albumId, limit), searchMode: 'direct-album'};
  const direct = directRequest(query);
  if (direct.explicit && !direct.id) throw new PluginError('unavailable', '无法识别指定的 YouTube 视频链接，请检查视频 ID。');
  if (host.app.platform === 'android') {
    let result;
    try { result = await android('search', { query: direct.id || query, limit }); }
    catch (error) {
      if (direct.explicit && error?.code === 'unavailable') throw new PluginError('unavailable', '指定的 YouTube 视频当前不可用，请检查链接或稍后重试。');
      throw error;
    }
    return direct.explicit ? exactTrack(result, direct.id) : result;
  }
  if (direct.id) {
    const value = await desktopTrack(direct.id);
    return exactTrack({items:value ? [value] : []}, direct.id);
  }
  return await desktopSearch(query, limit);
}

// Request only publicly available player data. Ciphered or otherwise protected URLs
// are not decoded; a directly usable CDN URL is required for playback.
async function desktopPlayer(id) {
  desktop();
  let response;
  try {
    response = await host.http.request('https://www.youtube.com/youtubei/v1/player?prettyPrint=false', {
      method:'POST', timeoutMs:8000, headers:{'Content-Type':'application/json'},
      body:JSON.stringify({context:{client:{clientName:'IOS', clientVersion:'20.10.4',
        deviceMake:'Apple', deviceModel:'iPhone16,2', osName:'iPhone', osVersion:'18.3.1.22D72', hl:'en'}}, videoId:id}),
    });
  } catch (_) { throw new PluginError('unavailable', '无法连接 YouTube，请检查网络。'); }
  if (response.status === 429) throw new PluginError('rateLimited', 'YouTube 请求过多，请稍后再试。');
  if (response.status !== 200) throw new PluginError('unavailable', 'YouTube 播放器当前不可用。');
  let data;
  try { data = await response.json(); }
  catch (_) { throw new PluginError('unavailable', 'YouTube 播放器返回了无效数据。'); }
  const status = data?.playabilityStatus?.status;
  if (status !== 'OK') {
    if (status === 'LOGIN_REQUIRED' || status === 'AGE_CHECK_REQUIRED' || status === 'AGE_VERIFICATION_REQUIRED') {
      throw new PluginError('signIn', '该内容要求登录或验证；当前插件只支持可公开访问的音乐。');
    }
    throw new PluginError('unavailable', '指定的 YouTube 视频当前不可用，请检查链接或稍后重试。');
  }
  if (data?.videoDetails?.videoId !== id || data.videoDetails.isLiveContent) {
    throw new PluginError('unavailable', '指定的 YouTube 视频不可用或为直播。');
  }
  return data;
}

async function desktopTrack(id) {
  const data = await desktopPlayer(id);
  const detail = data.videoDetails;
  if (!detail.title) throw new PluginError('unavailable', '指定的 YouTube 视频没有可读取的信息。');
  const seconds = Number(detail.lengthSeconds);
  return {id, title:detail.title, artists:[detail.author || 'YouTube Music'],
    durationMs:Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1000) : 0,
    artworkUrl:'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg'};
}

function audioUrl(raw) {
  // QuickJS does not expose the browser URL class. Only accept YouTube's signed CDN URLs.
  return typeof raw === 'string' && /^https:\/\/(?:[a-z0-9-]+\.)+googlevideo\.com(?::443)?\//i.test(raw);
}

export async function stream(params) {
  const id = String(params.id || '');
  if (!VIDEO_ID.test(id)) throw new PluginError('unavailable', '无效的 YouTube Music 歌曲 ID。');
  const requestedQuality = params.quality || host.setting('quality') || 'high';
  const quality = ['high', 'normal', 'low'].includes(requestedQuality) ? requestedQuality : 'high';
  if (host.app.platform === 'android') {
    const value = await android('stream', { id, quality });
    if (!audioUrl(value?.url) || !['audio/mp4', 'audio/mpeg'].includes(value.mimeType)) {
      throw new PluginError('unavailable', '本地解析器没有返回可播放的直连音频。');
    }
    return value;
  }
  const result = await desktopPlayer(id);
  const formats = (result.streamingData?.adaptiveFormats || []).filter(format =>
    !format.drmFamilies?.length && !format.drmTrackType && /^audio\/mp4(?:;|$)/i.test(format.mimeType || '') && audioUrl(format.url) &&
    Number.isFinite(Number(format.bitrate)) && Number(format.bitrate) > 0);
  formats.sort((a, b) => Number(a.bitrate) - Number(b.bitrate));
  const ceiling = quality === 'low' ? 70000 : quality === 'normal' ? 140000 : Infinity;
  const within = formats.filter(format => Number(format.bitrate) <= ceiling);
  const selected = within[within.length - 1] || formats[0];
  if (!selected) throw new PluginError('unavailable', '没有可播放的直连音频。');
  const expiry = /[?&]expire=(\d+)(?:&|$)/.exec(selected.url);
  return {url:selected.url, headers:{}, expiresAt:expiry ? Number(expiry[1]) * 1000 : undefined, mimeType:'audio/mp4'};
}

// Follow the lyrics tab advertised by the public Music web player for this ID.
// Only use the client version published by that instance of the website.
export async function lyrics({id}) {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(id)) return null;
  const page = await host.http.get('https://music.youtube.com/', {timeoutMs:2000});
  if (page.status !== 200) return null;
  const html = await page.text();
  const version = /"INNERTUBE_CLIENT_VERSION"\s*:\s*"([0-9.]+)"/.exec(html)?.[1];
  if (!version) return null;
  async function query(endpoint, fields) {
    const response = await host.http.request('https://music.youtube.com/youtubei/v1/' + endpoint, {
      method:'POST', timeoutMs:2000, headers:{'Content-Type':'application/json'},
      body:JSON.stringify({context:{client:{clientName:'WEB_REMIX', clientVersion:version}}, ...fields}),
    });
    return response.status === 200 ? response.json() : null;
  }
  const next = await query('next', {videoId:id, isAudioOnly:true});
  const tabs = next?.contents?.singleColumnMusicWatchNextResultsRenderer?.tabbedRenderer?.watchNextTabbedResultsRenderer?.tabs || [];
  const target = tabs.map(tab => tab.tabRenderer?.endpoint?.browseEndpoint).find(e =>
    e?.browseEndpointContextSupportedConfigs?.browseEndpointContextMusicConfig?.pageType === 'MUSIC_PAGE_TYPE_TRACK_LYRICS');
  if (!target?.browseId) return null;
  const browse = await query('browse', {browseId:target.browseId});
  const data = browse?.contents?.elementRenderer?.newElement?.type?.componentType?.model?.timedLyricsModel?.lyricsData;
  if (Array.isArray(data?.timedLyricsData)) {
    const lines = [];
    for (const cue of data.timedLyricsData.slice(0, 10000)) {
      const raw = cue?.cueRange?.startTimeMilliseconds;
      if (!/^\d{1,8}$/.test(String(raw))) continue;
      const ms = Number(raw);
      const text = typeof cue.lyricLine === 'string' ? cue.lyricLine.replace(/[\r\n]+/g, ' ').trim() : '';
      if (!text || !/[\p{L}\p{N}]/u.test(text) || ms >= 60000000) continue;
      const minutes = String(Math.floor(ms / 60000)).padStart(2, '0');
      const seconds = String(Math.floor(ms / 1000) % 60).padStart(2, '0');
      lines.push(`[${minutes}:${seconds}.${String(ms % 1000).padStart(3, '0')}]${text}`);
    }
    if (lines.length) return {format:'lrc', content:lines.join('\n')};
  }
  const shelf = browse?.contents?.sectionListRenderer?.contents?.find(s => s.musicDescriptionShelfRenderer)?.musicDescriptionShelfRenderer;
  const content = (shelf?.description?.runs || []).map(r => r.text || '').join('').trim();
  if (!content) return null;
  const credit = (shelf.footer?.runs || []).map(r => r.text || '').join('').trim();
  return {format:'plain', content:credit ? content + '\n\n' + credit : content};
}
