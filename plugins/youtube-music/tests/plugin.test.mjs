import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.PluginError = class extends Error {
  constructor(code, message) { super(message); this.code = code; }
};
const id = 'abcdefghij_';
const otherId = 'M4-XU0a2hf0';
const calls = [];
let handler;
globalThis.host = {
  app: { platform: 'macos' },
  setting: key => ({ searchLimit: '25', quality: 'high' })[key],
  spawn() { throw new Error('Desktop must not spawn a process'); },
  http: {
    async get(url, options) { calls.push({method:'GET', url, options}); return handler(url, options); },
    async request(url, options) { calls.push({method:'POST', url, options}); return handler(url, options); },
  },
};
const plugin = await import('../index.js');
const reply = (body, status=200) => ({status, text:async()=>typeof body === 'string' ? body : JSON.stringify(body), json:async()=>body});
const musicPage = () => reply('{"INNERTUBE_CLIENT_VERSION":"1.20260101.01.00"}');
const musicRow = (videoId, title, artist='Artist', duration='3:14') => ({musicResponsiveListItemRenderer:{
  playlistItemData:{videoId}, flexColumns:[
    {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:title}]}}},
    {musicResponsiveListItemFlexColumnRenderer:{text:{runs:[{text:artist,navigationEndpoint:{browseEndpoint:{browseEndpointContextSupportedConfigs:{browseEndpointContextMusicConfig:{pageType:'MUSIC_PAGE_TYPE_ARTIST'}}}}},{text:duration}]}}},
  ],
}});
const searchResult = rows => ({contents:{musicShelfRenderer:{contents:rows}}});

test('desktop search requests Music songs and preserves stable IDs and durations', async () => {
  calls.length=0;
  handler = url => url.endsWith('/search') ? reply(searchResult([musicRow(id,'Song'),musicRow(id,'Duplicate'),musicRow('bad','Invalid')])) : musicPage();
  const result=await plugin.search({query:'a & b',type:'track',limit:10});
  assert.equal(result.items.length,1);
  assert.equal(result.items[0].id,id);
  assert.equal(result.items[0].durationMs,194000);
  assert.deepEqual(result.items[0].artists,['Artist']);
  const request=JSON.parse(calls[1].options.body);
  assert.equal(request.query,'a & b');
  assert.equal(request.context.client.clientName,'WEB_REMIX');
  assert.ok(request.params);
});

test('desktop search falls back to public YouTube results', async()=>{
  calls.length=0;
  const data={contents:{videoRenderer:{videoId:id,title:{simpleText:'Fallback'},ownerText:{simpleText:'Artist'},lengthText:{simpleText:'2:30'}}}};
  handler=url=>url.includes('/results?')?reply('var ytInitialData = '+JSON.stringify(data)+';</script>'):reply('region unavailable');
  const page=await plugin.search({query:'a & b',type:'track'});
  assert.equal(page.items[0].id,id);
  assert.equal(page.items[0].durationMs,150000);
  assert.match(calls.at(-1).url,/search_query=a%20%26%20b/);
});

test('empty searches, invalid IDs, unsupported types and cursors make no requests', async()=>{
  calls.length=0;
  assert.deepEqual(await plugin.search({query:' ',type:'track'}),{items:[]});
  await assert.rejects(plugin.stream({id:'--exec=bad'}),{code:'unavailable'});
  await assert.rejects(plugin.search({query:'x',type:'album'}),{code:'unsupported'});
  await assert.rejects(plugin.search({query:'x',type:'track',cursor:'x'}),{code:'unsupported'});
  assert.equal(calls.length,0);
});

test('Android uses its native bridge and preserves errors', async()=>{
  host.app.platform='android'; calls.length=0;
  const nativeCalls=[];
  host.native={available:true,async call(operation,payload){nativeCalls.push({operation,payload});return operation==='search'?{items:[{id,title:'Song'}],searchMode:'youtube-audio-fallback'}:{url:'https://rr1.googlevideo.com/videoplayback?expire=1999999999',mimeType:'audio/mp4',headers:{'User-Agent':'native-client'}};}};
  try {
    const page=await plugin.search({query:'Artist',type:'track',limit:3});
    assert.equal(page.searchMode,'youtube-audio-fallback');
    assert.deepEqual(nativeCalls[0],{operation:'search',payload:{query:'Artist',limit:3}});
    assert.equal((await plugin.stream({id})).headers['User-Agent'],'native-client');
    host.native.call=async()=>{throw new PluginError('rateLimited','Try later');};
    await assert.rejects(plugin.stream({id}),{code:'rateLimited'});
    host.native.call=async()=>({url:'https://evil.example/audio',mimeType:'audio/mp4'});
    await assert.rejects(plugin.stream({id}),{code:'unavailable'});
    assert.equal(calls.length,0);
    host.native.available=false;
    await assert.rejects(plugin.stream({id}),{code:'setup'});
  } finally {delete host.native;host.app.platform='macos';}
});

test('Android explicit links demand exactly the requested ID', async()=>{
  host.app.platform='android';
  const queries=[];
  host.native={available:true,async call(operation,payload){queries.push(payload.query);return {items:[{id,title:'Related'}]};}};
  try {
    for(const query of [otherId,'https://www.youtube.com/watch?v='+otherId,'youtu.be/'+otherId,'https://www.youtube.com/shorts/'+otherId]) {
      await assert.rejects(plugin.search({query,type:'track'}),{code:'unavailable'});
      assert.equal(queries.at(-1),otherId);
    }
    host.native.call=async()=>({items:[{id:otherId,title:'Song'}]});
    assert.equal((await plugin.search({query:otherId,type:'track'})).searchMode,'direct-id');
  } finally {delete host.native;host.app.platform='macos';}
});

const format=(bitrate,url='https://rr1.googlevideo.com/videoplayback?expire=1999999999')=>({mimeType:'audio/mp4; codecs="mp4a.40.2"',bitrate,url});
const player=(videoId=id, extra={})=>({playabilityStatus:{status:'OK'},videoDetails:{videoId,title:'Song',author:'Artist',lengthSeconds:'12'},streamingData:{adaptiveFormats:[format(64000),format(128000),format(256000)]},...extra});

test('desktop exact links fetch only the requested video and reject mismatched IDs',async()=>{
  calls.length=0; handler=()=>reply(player());
  for(const query of [id,'https://music.youtube.com/watch?v='+id,'https://www.youtube.com/watch?v='+id+'&list=x','https://youtu.be/'+id]) {
    const page=await plugin.search({query,type:'track'});
    assert.equal(page.searchMode,'direct-id');
    assert.equal(page.items[0].id,id);
    assert.equal(JSON.parse(calls.at(-1).options.body).videoId,id);
  }
  handler=()=>reply(player(otherId));
  await assert.rejects(plugin.search({query:id,type:'track'}),{code:'unavailable'});
  const before=calls.length;
  for(const query of ['https://www.youtube.com/watch?v=bad','https://youtube.com@evil.example/watch?v='+id]) await assert.rejects(plugin.search({query,type:'track'}),{code:'unavailable'});
  assert.equal(calls.length,before);
});

test('desktop stream selects audio quality and exposes signed URL expiry',async()=>{
  calls.length=0;
  handler=()=>reply(player(id,{streamingData:{adaptiveFormats:[format(64000,'https://rr1.googlevideo.com/audio?expire=1999999999&quality=low'),format(128000,'https://rr1.googlevideo.com/audio?quality=normal'),format(256000,'https://rr1.googlevideo.com/audio?quality=high')]}}));
  assert.match((await plugin.stream({id,quality:'high'})).url,/quality=high/);
  assert.match((await plugin.stream({id,quality:'normal'})).url,/quality=normal/);
  const low=await plugin.stream({id,quality:'low'});
  assert.match(low.url,/quality=low/);
  assert.equal(low.mimeType,'audio/mp4');
  assert.equal(low.expiresAt,1999999999000);
  assert.ok(calls.every(call=>call.url.includes('/youtubei/v1/player')));
});

test('desktop rejects region blocks, mismatched IDs, live streams and unsafe or cipher-only audio',async()=>{
  for(const body of [
    player(id,{playabilityStatus:{status:'UNPLAYABLE',reason:'Not available in your country'}}),
    player(otherId),
    player(id,{videoDetails:{videoId:id,title:'Live',isLiveContent:true}}),
    player(id,{streamingData:{adaptiveFormats:[format(128000,'https://googlevideo.com.evil.test/audio')]}}),
    player(id,{streamingData:{adaptiveFormats:[format(128000,'http://rr1.googlevideo.com/audio')]}}),
    player(id,{streamingData:{adaptiveFormats:[{mimeType:'audio/mp4',bitrate:128000,signatureCipher:'url=secret'}]}}),
    player(id,{streamingData:{adaptiveFormats:[{mimeType:'video/mp4',bitrate:128000,url:'https://rr1.googlevideo.com/video'}]}}),
  ]) {
    handler=()=>reply(body);
    await assert.rejects(plugin.stream({id}),{code:'unavailable'});
  }
});
