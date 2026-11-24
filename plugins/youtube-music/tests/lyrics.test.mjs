import {test} from 'node:test';
import assert from 'node:assert/strict';
import {lyrics} from '../index.js';
test('uses the origin video lyrics tab and keeps its credit', async () => {
  const endpoint = {browseId:'fixture',browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_TRACK_LYRICS'}}};
  const next = {contents:{singleColumnMusicWatchNextResultsRenderer:{tabbedRenderer:{watchNextTabbedResultsRenderer:{tabs:[{tabRenderer:{endpoint:{browseEndpoint:endpoint}}}]}}}}};
  const shelf = {description:{runs:[{text:'fixture line'}]},footer:{runs:[{text:'fixture credit'}]}};
  const browse = {contents:{sectionListRenderer:{contents:[{musicDescriptionShelfRenderer:shelf}]}}};
  const calls = [];
  globalThis.host = {http:{get:async()=>({status:200,text:async()=>'"INNERTUBE_CLIENT_VERSION":"1.0"'}),request:async(url,{body})=>{calls.push(JSON.parse(body));return {status:200,json:async()=>url.endsWith('/next')?next:browse};}}};
  assert.equal((await lyrics({id:'M4-XU0a2hf0'})).content,'fixture line\n\nfixture credit');
  assert.equal(calls[0].videoId,'M4-XU0a2hf0');
  assert.equal(calls[1].browseId,'fixture');
  browse.contents.elementRenderer = {newElement:{type:{componentType:{model:{timedLyricsModel:{lyricsData:{timedLyricsData:[
    {lyricLine:'日本語',cueRange:{startTimeMilliseconds:'61009'}},
    {lyricLine:'♪',cueRange:{startTimeMilliseconds:'62000'}},
    {lyricLine:'missing time',cueRange:{startTimeMilliseconds:null}},
  ]}}}}}}};
  assert.deepEqual(await lyrics({id:'M4-XU0a2hf0'}),{format:'lrc',content:'[01:01.009]日本語'});
  globalThis.host.http.get = async()=>({status:200,text:async()=>'<title>YouTube Music is not available in your area</title>'});
  assert.equal(await lyrics({id:'M4-XU0a2hf0'}),null);
  assert.equal(calls.length,4);
});
