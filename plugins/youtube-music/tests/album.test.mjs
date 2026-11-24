import { test } from 'node:test';
import assert from 'node:assert/strict';
globalThis.PluginError = class extends Error { constructor(code, message) { super(message); this.code = code; } };
let mode = 'ok'; const calls = [];
const rows = [
  ['abcdefghijk','First', 'Artist', '3:14'], ['12345678901','Second','Artist','4:05'],
].map(([id,title,artist,duration])=>({musicResponsiveListItemRenderer:{
 playlistItemData:{videoId:id},
 flexColumns:[{musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:title}]}}},
 {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:artist,navigationEndpoint:{browseEndpoint:{browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_ARTIST'}}}}}]}}}],
 fixedColumns:[{musicResponsiveListItemFixedColumnRenderer:{text:{runs:[{text:duration}]}}}],
}}));
globalThis.host = {app:{platform:'android'},setting:()=>25,http:{
 async get(url) {calls.push(url);return {status:200,text:async()=>mode==='region'?'Music unavailable':'{"INNERTUBE_CLIENT_VERSION":"1.20260101.01.00"}'}},
 async request(url,opts){calls.push(JSON.parse(opts.body));return {status:200,json:async()=>({header:{musicDetailHeaderRenderer:{title:{runs:[{text:'Album'}]}}},contents:{sectionListRenderer:{contents:[{musicShelfRenderer:{contents:rows}}]}}})}}
}};
const {search,browse} = await import('../index.js');
test('album browse URL returns ordered playable songs with album and durations', async()=>{
 mode='ok'; calls.length=0;
 const result=await search({query:'https://music.youtube.com/browse/MPREb_example123?si=share',type:'track',limit:50});
 assert.equal(result.searchMode,'direct-album'); assert.deepEqual(result.items.map(x=>x.id),['abcdefghijk','12345678901']);
 assert.equal(result.items[0].durationMs,194000); assert.equal(result.items[0].album,'Album'); assert.deepEqual(result.items[0].artists,['Artist']);
 assert.equal(calls[1].browseId,'MPREb_example123');
});
test('album playlist links and native browse path preserve exact album ID', async()=>{
 calls.length=0; await search({query:'https://music.youtube.com/playlist?list=OLAK5uy_ABC123',type:'track'});
 assert.equal(calls[1].browseId,'VLOLAK5uy_ABC123');
 assert.deepEqual((await browse({path:'album:MPREb_example123'})).items.map(x=>x.kind),['track','track']);
});
test('unavailable Music region never substitutes other results',async()=>{
 mode='region'; await assert.rejects(search({query:'https://music.youtube.com/browse/MPREb_example123',type:'track'}), {code:'unavailable'});
});
