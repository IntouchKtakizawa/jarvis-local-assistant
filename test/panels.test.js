import test from 'node:test';
import assert from 'node:assert/strict';
import {mapRequest,plannerRequest,MapProvider} from '../server/panels.js';
const user=content=>({role:'user',content});
test('map requests and picture follow-ups dispatch to an actual map panel',()=>{
 assert.deepEqual(mapRequest([user('Show me a picture map of Thailand')]),{query:'Thailand'});
 assert.deepEqual(mapRequest([user('Show Bangkok on a map')]),{query:'Bangkok'});
 assert.deepEqual(mapRequest([user('Map of Thailand'),{role:'assistant',content:'Map'},user('An actual picture please')]),{query:'Thailand'});
 assert.equal(mapRequest([user('Explain the array map function')]),null);
});
test('calendar requests produce a local seven-day UI with correct dates, without claiming sync',()=>{
 const now=new Date('2026-10-30T20:00:00Z');const result=plannerRequest([user('Show my calendar for the next 7 days')],'Asia/Bangkok',now);
 assert.equal(result.startDate,'2026-10-31');assert.equal(result.days,7);assert.equal(result.synced,false);assert.equal(result.mode,'local');
 assert.equal(plannerRequest([user('Calendar starting tomorrow')],'Asia/Bangkok',now).startDate,'2026-11-01');
 assert.ok(plannerRequest([user('Show my calendar'),user('for 7 days')],'Asia/Bangkok',now));assert.equal(plannerRequest([user('Write a calendar API')]),null);
});
test('map lookups use the fixed geocoder, bounded results, attribution URL and cache',async()=>{
 let calls=0;const provider=new MapProvider({fetcher:async(url,options)=>{calls++;assert.equal(url.hostname,'nominatim.openstreetmap.org');assert.equal(url.searchParams.get('q'),'Thailand');assert.match(options.headers['User-Agent'],/JarvisLocalAssistant/);return Response.json([{name:'Thailand',display_name:'Thailand',lat:'14.89',lon:'100.83',boundingbox:['5.6','20.4','97.3','105.6']}]);}});
 const map=await provider.lookup('Thailand');assert.equal(map.lat,14.89);assert.equal(map.bounds.length,4);assert.match(map.source,/openstreetmap.org/);await provider.lookup('Thailand');assert.equal(calls,1);
 const missing=new MapProvider({fetcher:async()=>Response.json([])});await assert.rejects(missing.lookup('not-a-place'),/couldn’t locate/);
});
