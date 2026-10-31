import test from 'node:test';
import assert from 'node:assert/strict';
import {WeatherProvider,weatherQuery,weatherSummary} from '../server/weather.js';
const q=text=>weatherQuery([{role:'user',content:text}]);
const raw={timezone:'Asia/Bangkok',current_units:{wind_speed_10m:'km/h'},current:{time:'2026-10-30T19:00',temperature_2m:30.1,apparent_temperature:34.2,relative_humidity_2m:75,wind_speed_10m:8.2,weather_code:3,is_day:0},daily:{time:['2026-10-30','2026-10-31'],temperature_2m_max:[32,33],temperature_2m_min:[26,27],precipitation_probability_max:[60,70],weather_code:[3,61]},hourly:{time:['2026-10-30T20:00','2026-10-30T21:00'],temperature_2m:[29,28],precipitation_probability:[40,50],weather_code:[3,61]}};
test('weather intent resolves cities, tomorrow, units, and contextual follow-ups',()=>{
 assert.deepEqual(q('What is the weather in Bangkok today?'),{city:'Bangkok',day:0,fahrenheit:false});
 assert.deepEqual(q('Forecast for Tokyo tomorrow in Fahrenheit'),{city:'Tokyo',day:1,fahrenheit:true});
 assert.equal(weatherQuery([{role:'user',content:'Weather in London?'},{role:'assistant',content:'Forecast'},{role:'user',content:'What about tomorrow?'}]).city,'London');
 assert.equal(q('Explain rain'),null);assert.equal(q('Write a weather API'),null);assert.equal(q('Tell me about Saturn'),null);
});
test('weather uses fixed API endpoints, numeric data, local time, and a five-minute cache',async()=>{
 let calls=0;const p=new WeatherProvider({fetcher:async url=>{calls++;assert.ok(['geocoding-api.open-meteo.com','api.open-meteo.com'].includes(url.hostname));return Response.json(url.hostname.startsWith('geocoding')?{results:[{name:'Bangkok',country:'Thailand',latitude:13.75,longitude:100.5}]}:raw);}});
 const w=await p.lookup(q('Weather in Bangkok'));assert.equal(w.current.temp,30.1);assert.equal(w.current.time,'2026-10-30T19:00');assert.equal(w.daily[1].rain,70);assert.equal(w.hourly[0].temp,29);assert.match(weatherSummary(w),/30°C/);const tomorrow=await p.lookup(q('Weather in Bangkok tomorrow'));assert.equal(tomorrow.selectedDay,1);assert.equal(calls,2);assert.match(weatherSummary(tomorrow),/high of 33°C/);
});
test('weather failures never become invented temperatures',async()=>{
 const missing=new WeatherProvider({fetcher:async()=>Response.json({results:[]})});await assert.rejects(missing.lookup(q('Weather in Unknowncity')),/couldn’t find/);
 const broken=new WeatherProvider({fetcher:async url=>Response.json(url.hostname.startsWith('geocoding')?{results:[{name:'Bangkok',latitude:1,longitude:1}]}:{})});await assert.rejects(broken.lookup(q('Weather in Bangkok')),/incomplete/);
});
