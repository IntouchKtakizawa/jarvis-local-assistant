const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
const rounded=v=>v===null||v===undefined?'—':String(Math.round(v));
const hour=t=>{const h=Number(t.slice(11,13));return `${h%12||12}${h<12?'am':'pm'}`;};
const dayName=(date,i)=>i===0?'Today':i===1?'Tomorrow':new Intl.DateTimeFormat('en',{weekday:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z'));
let chartId=0;
export function renderWeather(w,reply){
 const card=el('section','weather-card');card.setAttribute('aria-label',`${w.location.name} weather forecast`);let selected=Math.min(w.selectedDay||0,w.daily.length-1);
 function draw(){
 card.replaceChildren();const d=w.daily[selected],now=selected===0;
 const header=el('div','weather-heading'),place=el('div');place.append(el('div','visual-eyebrow','WEATHER · '+w.timezone),el('h3','',w.location.name));const region=el('span','weather-region',w.location.country);place.append(region);header.append(place,el('span','weather-icon',now?w.current.icon:d.icon));
 const hero=el('div','weather-hero'),temperature=el('div','weather-temperature');temperature.append(el('strong','',rounded(now?w.current.temp:d.high)),el('span','',w.unit));const copy=el('div','weather-condition');copy.append(el('strong','',now?w.current.label:d.label),el('span','',now?`Feels like ${rounded(w.current.feels)}${w.unit}`:`${dayName(d.time,selected)} · forecast high`),el('span','',`High ${rounded(d.high)}° · Low ${rounded(d.low)}°`));hero.append(temperature,copy);
 const metrics=el('div','weather-metrics');for(const [name,value]of [['Rain chance',`${rounded(d.rain)}%`],['Humidity now',`${rounded(w.current.humidity)}%`],['Wind now',`${rounded(w.current.wind)} ${w.windUnit}`]]){const m=el('div');m.append(el('span','',name),el('strong','',value));metrics.append(m);}
 const chart=el('div','weather-chart'),heading=el('div','weather-chart-heading');heading.append(el('strong','',now?'Next 24 hours':dayName(d.time,selected)+' · hourly forecast'));const detail=el('span','weather-chart-detail','Hover or tap a point');heading.append(detail);chart.append(heading);
 const hours=(now?w.hourly.filter(h=>h.time>=w.current.time):w.hourly.filter(h=>h.time.startsWith(d.time))).slice(0,24);
 if(hours.length){
  const NS='http://www.w3.org/2000/svg',svg=document.createElementNS(NS,'svg');svg.setAttribute('viewBox','0 0 640 155');svg.setAttribute('role','img');svg.setAttribute('aria-label',`Hourly temperature graph for ${w.location.name}, ${dayName(d.time,selected)}`);
  const add=(tag,attrs,parent=svg)=>{const n=document.createElementNS(NS,tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,String(v));parent.append(n);return n;};
  const temps=hours.map(h=>h.temp),min=Math.floor(Math.min(...temps)-1),max=Math.ceil(Math.max(...temps)+1),x=i=>40+i*580/Math.max(1,hours.length-1),y=v=>112-(v-min)/(max-min)*92;
  for(let i=0;i<3;i++){const v=min+(max-min)*i/2;add('line',{x1:38,y1:y(v),x2:624,y2:y(v),stroke:'#29424e','stroke-dasharray':'3 6'});const label=add('text',{x:29,y:y(v)+4,fill:'#799ba9','font-size':10,'text-anchor':'end'});label.textContent=rounded(v)+'°';}
  const id='weather-fill-'+(++chartId),defs=add('defs',{}),gradient=add('linearGradient',{id,x1:0,y1:0,x2:0,y2:1},defs);add('stop',{offset:'0%','stop-color':'#7ce2ff','stop-opacity':'.24'},gradient);add('stop',{offset:'100%','stop-color':'#7ce2ff','stop-opacity':'0'},gradient);
  const points=hours.map((h,i)=>`${x(i)},${y(h.temp)}`).join(' ');add('polygon',{points:`40,120 ${points} ${x(hours.length-1)},120`,fill:`url(#${id})`});add('polyline',{points,fill:'none',stroke:'#84deff','stroke-width':3,'stroke-linecap':'round','stroke-linejoin':'round'});
  hours.forEach((h,i)=>{const c=add('circle',{cx:x(i),cy:y(h.temp),r:5,fill:'#84deff',stroke:'#122a39','stroke-width':2,tabindex:0,role:'button','aria-label':`${hour(h.time)}, ${rounded(h.temp)}${w.unit}, rain ${rounded(h.rain)}%`});const show=()=>{detail.textContent=`${hour(h.time)} · ${rounded(h.temp)}${w.unit} · rain ${rounded(h.rain)}%`;};c.addEventListener('pointerenter',show);c.addEventListener('pointerdown',show);c.addEventListener('focus',show);if(i%6===0||i===hours.length-1){const label=add('text',{x:x(i),y:146,fill:'#91b0bf','font-size':11,'text-anchor':'middle'});label.textContent=hour(h.time);}});chart.append(svg);
 }
 const days=el('div','weather-days');for(const [i,forecast]of w.daily.entries()){const b=el('button','weather-day');b.type='button';b.setAttribute('aria-pressed',String(i===selected));b.append(el('span','',dayName(forecast.time,i)),el('span','day-icon',forecast.icon),el('strong','',`${rounded(forecast.high)}°`),el('span','day-low',`${rounded(forecast.low)}°`),el('small','',`${rounded(forecast.rain)}% rain`));b.addEventListener('click',()=>{selected=i;draw();card.querySelectorAll('.weather-day')[i]?.focus({preventScroll:true});});days.append(b);}
 const credit=el('div','weather-credit');credit.append(el('span','',`As of ${w.current.time.slice(11,16)} local · forecast model data`));const source=el('a','','Open-Meteo ↗');source.href=w.source;source.target='_blank';source.rel='noopener noreferrer';credit.append(source);card.append(header,hero,metrics,chart,days,credit);
 }
 draw();reply.el.insertBefore(card,reply.content);
}
