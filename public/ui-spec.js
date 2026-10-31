// Declarative UI contracts shared by the agent and browser. No scripts or HTML.
const TYPES=new Set(['text','metric','input','slider','select','button','checklist','timer','stopwatch','progress','chart','table']);
const OPS=new Set(['set','increment','toggle','append_item','clear_completed','start','pause','reset']);
const ident=v=>typeof v==='string'&&/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(v);
const text=(v,n=300)=>typeof v==='string'?v.slice(0,n):'';
const number=(v,fallback=0)=>typeof v==='number'&&Number.isFinite(v)?v:fallback;
function action(a,ids){if(!a||!OPS.has(a.operation)||!ids.has(a.target))throw Error('A button action needs a supported operation and an existing component target.');if(a.value_from&&!ids.has(a.value_from))throw Error('Button value source does not exist.');return {operation:a.operation,target:a.target,value:typeof a.value==='boolean'||typeof a.value==='number'?a.value:text(a.value,3000),value_from:a.value_from||''};}
export function validateUISpec(input){
 if(typeof input==='string'){if(input.length>24000)throw Error('Keep the interface specification under 24,000 characters.');try{input=JSON.parse(input);}catch{throw Error('Interface specification must be valid JSON.');}}
 if(!input||!ident(input.id)||typeof input.title!=='string'||!input.title.trim())throw Error('An interface needs a stable simple id and a title.');
 if(!Array.isArray(input.components)||!input.components.length||input.components.length>24)throw Error('Use between 1 and 24 UI components.');
 const ids=new Set();for(const c of input.components){if(!c||!ident(c.id)||ids.has(c.id)||!TYPES.has(c.type))throw Error('Use unique component ids and supported component types.');ids.add(c.id);}
 const components=input.components.map(c=>{
  const base={id:c.id,type:c.type,label:text(c.label,160)};
  if(c.type==='text')return {...base,text:text(c.text,3000)};
  if(c.type==='timer'){if(!Number.isFinite(c.duration_seconds)||c.duration_seconds<1||c.duration_seconds>31536000)throw Error('Timer duration must be 1 second to 365 days.');return {...base,duration_seconds:Math.round(c.duration_seconds),autostart:c.autostart===true};}
  if(c.type==='stopwatch')return {...base,autostart:c.autostart===true};
  if(c.type==='button'){if(!Array.isArray(c.actions)||c.actions.length<1||c.actions.length>6)throw Error('A button needs 1–6 local actions.');return {...base,actions:c.actions.map(a=>action(a,ids)),style:['primary','quiet'].includes(c.style)?c.style:'primary'};}
  if(c.type==='checklist'){if(c.items!==undefined&&!Array.isArray(c.items))throw Error('Checklist items must be an array.');return {...base,items:(c.items||[]).slice(0,60).map((item,i)=>({id:'item_'+i,text:text(typeof item==='string'?item:item?.text,300),done:item?.done===true})).filter(i=>i.text),editable:c.editable!==false};}
  if(c.type==='table'){if(!Array.isArray(c.columns)||!Array.isArray(c.rows))throw Error('Tables need columns and rows.');return {...base,columns:c.columns.slice(0,8).map(v=>text(v,80)),rows:c.rows.slice(0,50).map(r=>{if(!Array.isArray(r))throw Error('Table rows must be arrays.');return r.slice(0,8).map(v=>text(String(v??''),300));})};}
  if(c.type==='chart'){if(!Array.isArray(c.points)||c.points.length>80)throw Error('A chart needs at most 80 data points.');return {...base,unit:text(c.unit,30),points:c.points.map(p=>({label:text(p?.label,60),value:number(p?.value)}))};}
  if(c.type==='select'){if(!Array.isArray(c.options)||!c.options.length||c.options.length>30)throw Error('A select needs 1–30 text options.');const options=c.options.map(v=>text(v,100));return {...base,options,value:options.includes(c.value)?c.value:options[0]};}
  if(c.type==='input')return {...base,input_type:['text','number','date','time','textarea'].includes(c.input_type)?c.input_type:'text',placeholder:text(c.placeholder,180),value:typeof c.value==='number'?number(c.value):text(c.value,3000)};
  if(c.type==='slider')return {...base,min:number(c.min),max:number(c.max,100),step:Math.max(.001,number(c.step,1)),value:number(c.value),unit:text(c.unit,30)};
  const formula=c.formula||(typeof c.value==='string'&&/\{[a-zA-Z][a-zA-Z0-9_-]*\}/.test(c.value)?c.value:'');
  if(typeof formula!=='string'||formula.length>300||/[^a-zA-Z0-9_{}.+\-*/^%(),\s]/.test(formula))throw Error('Formulas support arithmetic and component references such as {price}*{quantity}.');
  for(const match of formula.matchAll(/\{([^}]+)\}/g))if(!ids.has(match[1]))throw Error('Formula references an unknown component.');
  if(c.type==='progress')return {...base,value:number(c.value),max:Math.max(1,number(c.max,100)),unit:text(c.unit,30),formula};
  return {...base,value:typeof c.value==='number'?number(c.value):text(c.value,300),unit:text(c.unit,30),formula};
 });
 return {id:input.id,title:text(input.title,100),description:text(input.description,500),layout:input.layout==='grid'?'grid':'stack',components};
}
export function timerRemaining(state,now=Date.now()){return state.running?Math.max(0,(state.deadline-now)/1000):Math.max(0,state.remaining);}
export function stopwatchElapsed(state,now=Date.now()){return state.elapsed+(state.running?Math.max(0,now-state.startedAt)/1000:0);}
export function initialUIState(spec,issuedAt=Date.now()){
 return Object.fromEntries(spec.components.map(c=>[c.id,c.type==='timer'?{remaining:c.duration_seconds,running:c.autostart,deadline:c.autostart?issuedAt+c.duration_seconds*1000:null,completed:false}:c.type==='stopwatch'?{elapsed:0,running:c.autostart,startedAt:issuedAt}:c.type==='checklist'?c.items.map(i=>({...i})):c.value??'']));
}
export function applyUIAction(spec,state,a,now=Date.now()){
 const c=spec.components.find(c=>c.id===a.target);if(!c||!OPS.has(a.operation))throw Error('This control is not available.');const current=state[c.id];let value=a.value_from?state[a.value_from]:a.value;
 if(c.type==='timer'){
  if(a.operation==='pause'){current.remaining=timerRemaining(current,now);current.running=false;}
  else if(a.operation==='start'){if(timerRemaining(current,now)<=0)current.remaining=c.duration_seconds;else current.remaining=timerRemaining(current,now);current.deadline=now+current.remaining*1000;current.running=true;current.completed=false;}
  else if(a.operation==='reset')state[c.id]={remaining:c.duration_seconds,running:false,deadline:null,completed:false};
  else if(a.operation==='set'){value=Number(value);if(!Number.isFinite(value)||value<1||value>31536000)throw Error('Choose a duration in seconds from 1 to 31,536,000.');state[c.id]={remaining:value,running:false,deadline:null,completed:false};}
  else throw Error('Use start, pause, reset, or set duration on a timer.');
 }else if(c.type==='stopwatch'){
  if(a.operation==='pause'){current.elapsed=stopwatchElapsed(current,now);current.running=false;}
  else if(a.operation==='start'&&!current.running){current.startedAt=now;current.running=true;}
  else if(a.operation==='reset')state[c.id]={elapsed:0,running:false,startedAt:now};
  else if(a.operation!=='start')throw Error('Use start, pause, or reset on a stopwatch.');
 }else if(c.type==='checklist'){
  if(a.operation==='append_item'){if(current.length>=60)throw Error('This list has reached 60 items.');if(String(value||'').trim())current.push({id:'item_'+now+'_'+current.length,text:String(value).trim().slice(0,300),done:false});}
  else if(a.operation==='clear_completed')state[c.id]=current.filter(i=>!i.done);
  else if(a.operation==='toggle'){const item=current.find(i=>i.id===String(value));if(item)item.done=!item.done;}
  else if(a.operation==='reset')state[c.id]=c.items.map(i=>({...i}));
  else throw Error('Use append_item, clear_completed, toggle, or reset on a checklist.');
 }else if(a.operation==='reset')state[c.id]=c.value??'';
 else if(a.operation==='increment'){const next=Number(current)+Number(value);if(!Number.isFinite(next))throw Error('Use a finite number.');state[c.id]=next;}
 else if(a.operation==='set'){if(c.type==='slider'||c.type==='progress'||c.input_type==='number'){value=Number(value);if(!Number.isFinite(value))throw Error('Use a finite number.');if(c.type==='slider')value=Math.min(c.max,Math.max(c.min,value));}else value=String(value??'').slice(0,3000);if(c.type==='select'&&!c.options.includes(value))throw Error('Choose a listed option.');state[c.id]=value;}
 else throw Error('This component does not support that action.');
 return state;
}
export function restoreUIState(spec,saved,now=Date.now()){
 const state=initialUIState({...spec,components:spec.components.map(c=>({...c,autostart:false}))},now);if(!saved||typeof saved!=='object')return state;
 for(const c of spec.components){const v=saved[c.id];
  if(c.type==='timer'&&v&&typeof v==='object'&&Number.isFinite(v.remaining)&&v.remaining>=0&&v.remaining<=31536000&&(!v.running||Number.isFinite(v.deadline))){state[c.id]={remaining:v.remaining,running:v.running===true,deadline:v.running?Math.min(v.deadline,now+31536000000):null,completed:v.completed===true};}
  else if(c.type==='stopwatch'&&v&&typeof v==='object'&&Number.isFinite(v.elapsed)&&v.elapsed>=0&&Number.isFinite(v.startedAt)){state[c.id]={elapsed:Math.min(v.elapsed,31536000),running:v.running===true,startedAt:Math.min(now,v.startedAt)};}
  else if(c.type==='checklist'&&Array.isArray(v))state[c.id]=v.slice(0,60).filter(i=>i&&typeof i.text==='string'&&typeof i.id==='string').map((i,n)=>({id:i.id.slice(0,100)||'item_'+n,text:i.text.slice(0,300),done:i.done===true}));
  else if(!['timer','stopwatch','checklist','button','text','table','chart'].includes(c.type)&&['string','number'].includes(typeof v)){if(c.type==='select'){if(c.options.includes(v))state[c.id]=v;}else if(typeof v==='number'&&Number.isFinite(v))state[c.id]=c.type==='slider'?Math.min(c.max,Math.max(c.min,v)):v;else if(typeof v==='string')state[c.id]=v.slice(0,3000);}
 }
 return state;
}
