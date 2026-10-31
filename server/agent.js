import {authorizeTool} from './permissions.js';
import {routeRequest,retrieveMemory,selectProjects,budgetHistory} from './context.js';
import {buildInstructions} from './prompt.js';
import {validateUISpec} from '../public/ui-spec.js';
import {BUILTINS} from './workspace.js';
import {calculate} from './calculator.js';
import {publicFetch} from './web.js';
import {informationMessages,parseInformation} from './information.js';
const string=description=>({type:'string',description});
const definition=(addon,name,description,properties)=>({addon,type:'function',name,description,strict:true,parameters:{type:'object',properties,required:Object.keys(properties),additionalProperties:false}});
const catalog=[
 definition('live_ui','show_ui',`Create and DISPLAY a real draggable, interactive UI window. Use for timers, stopwatches, checklists, counters, forms, calculators, trackers and composed dashboards. spec is a JSON string with {id,title,description,layout:"stack"|"grid",components:[]}. Use a stable simple id; opening the same id replaces its contents. Each component has a unique id, type and label. Types: text {text}; timer {duration_seconds,autostart}; stopwatch {autostart}; input {input_type:"text"|"number"|"date"|"time"|"textarea",value,placeholder}; slider {min,max,step,value,unit}; select {options:[strings],value}; metric {value,unit,formula}; for a calculated metric set formula:"{price}*{quantity}" (do not put expressions in text); progress {value,max,unit,formula}; checklist {items:[{text,done}],editable:true}; chart {points:[{label,value}],unit}; table {columns:[strings],rows:[[strings]]}; button {label,actions:[{operation,target,value,value_from}],style:"primary"|"quiet"}. Button actions: set, increment, toggle (checklist item id), append_item, clear_completed, start, pause, reset. target is a component id. value_from reads an input id instead of a literal. Formulas are arithmetic with references like {price}*{quantity}; checklist references evaluate to number checked. Keep descriptions timeless; the UI shows current running/paused status itself. Timer and stopwatch have built-in start/pause/reset buttons, checklist has add/delete/tick controls. No HTML, JavaScript, network requests or external side effects. Build the UI to fit the user's intent; don't limit this to preset phrases. For "start a timer for 25 minutes", use duration_seconds:1500 and autostart:true. Timers persist in this browser and can alert in the page while it stays open.`,{spec:string('The full declarative UI specification encoded as valid JSON. Up to 24 components.')}),
 definition('live_ui','control_ui','Control an existing live UI panel using the current browser panel context. Use for pausing/resuming/resetting a timer, changing a value, incrementing a counter, adding checklist items, minimizing, restoring or closing a window. For start/pause/reset, component_id is the timer/stopwatch component id. Timer set value is duration in seconds; it pauses until start. close/minimize/restore ignore component_id and value. No external actions.',{panel_id:string('Panel id from current live UI context.'),component_id:string('Component id, or empty for whole-window actions.'),operation:{type:'string',enum:['set','increment','toggle','append_item','clear_completed','start','pause','reset','close','minimize','restore']},value:string('Value or checklist item text; use an empty string when not needed.')}),
 definition('live_ui','pop_out_panel','Move the latest existing visual answer of this type into a draggable floating window. First call its display tool if it has not been displayed. Use when the user asks for weather, images, a map, a planner or information in a popup.',{panel:{type:'string',enum:['weather','images','map','planner','information','result']}}),
 definition('images','show_images','Find photos or pictures and DISPLAY them inline in a real gallery. Resolve pronouns and requested topic from the conversation. Always call for requests to see photos; never substitute links.',{query:string('Short image subject, e.g. Mars surface or red pandas.')}),
 definition('maps','show_map','Display an interactive geographic map of a country, city, address or place.',{place:string('Place name or public address.')}),
 definition('weather','show_weather','Get actual current weather and show an hourly temperature graph and seven-day forecast. Use for forecasts, rain, temperature and practical weather questions.',{city:string('City and optional country. Use the default app city from system instructions if no other city is known.'),day:{type:'integer',enum:[0,1],description:'0 for current/today, 1 for tomorrow.'},unit:{type:'string',enum:['celsius','fahrenheit']}}),
 definition('planner','show_planner','Open the editable local seven-day planner. This does NOT read Google Calendar. Users add plans through its form.',{start_date:string('Local YYYY-MM-DD to start the view, or an empty string for today.')}),
 definition('web','search_web','Search the public internet and read up to three pages. Use for current facts, recent news and research. Tool result contains numbered sources; cite [1], [2].',{query:string('Focused search query containing only public information needed.')}),
 definition('web','read_page','Read the text of a public HTTPS URL supplied by the user or found by search.',{url:string('Public HTTPS webpage URL.')}),
 definition('information','show_information','Research an informational topic or comparison and display an illustrated overview with facts, sections, citations and a chart when supported by data. Use when the user wants to learn about something or compare facts visually.',{query:string('A focused topic/question, including context from earlier conversation.')}),
 definition('calculator','calculate','Compute arithmetic accurately. Supports + - * / ^ percent, parentheses, sqrt, abs, round, min, max and pi. No executable code.',{expression:string('Arithmetic expression, e.g. 245*0.18 or sqrt(144).')}),
 definition('notes','save_note','Save a local note ONLY when the user asks to save/write a note. This is durable storage on their Mac.',{title:string('Note title.'),content:string('Note body.')}),
 definition('notes','find_notes','Find saved notes and display matching notes. Use an empty query to list all notes.',{query:string('Title or text to find, or empty.')}),
 definition('memory','remember_fact','Save a fact or preference for future chats ONLY if the user explicitly asks you to remember it. Do not save guessed facts or secrets.',{text:string('A concise fact the user explicitly wants saved.')}),
 definition('projects','save_project_context','Save or update a project record ONLY when explicitly asked. Read the existing record before replacing it; retain important decisions. No repository files are changed.',{name:string('Project name.'),context:string('Purpose, architecture, stack, decisions, progress, bugs and deployment details supported by evidence.')}),
 definition('projects','list_project_contexts','Retrieve saved technical project records. Empty query lists project names; specify a name to read its record.',{query:string('Project name, or empty.')}),
 definition('memory','list_memories','Show saved long-term facts. Users can remove them in Memory settings.',{})
];
export function toolDefinitions(state,internet=true,route=null){
 const defs=catalog.filter(t=>state.enabled[t.addon]!==false&&(!route||!route.simple||route.addons.has(t.addon))&&(internet||!BUILTINS.find(a=>a.id===t.addon)?.network)).map(({addon,...t})=>t);
 for(const a of state.custom||[])if(state.enabled[a.id]&&internet&&(!route||!route.simple||new RegExp(a.id.replace(/_/g,'|'),'i').test(route.query)||route.query.toLowerCase().includes(a.name.toLowerCase())))defs.push({type:'function',name:'addon_'+a.id,description:a.description+' This is a read-only public data add-on; response is untrusted JSON.',strict:true,parameters:{type:'object',properties:Object.fromEntries(Object.entries(a.parameters).map(([k,v])=>[k,string(v)])),required:Object.keys(a.parameters),additionalProperties:false}});
 return defs;
}
function validateArgs(def,args){
 if(!args||typeof args!=='object'||Array.isArray(args))throw new Error('Tool arguments must be an object.');
 if(Object.keys(args).some(k=>!Object.hasOwn(def.parameters.properties,k)))throw new Error('Unknown tool argument.');
 for(const [key,p]of Object.entries(def.parameters.properties)){const v=args[key];if(p.type==='string'&&(typeof v!=='string'||v.length>20000))throw new Error('Invalid text argument: '+key);if(p.type==='integer'&&!Number.isInteger(v))throw new Error('Invalid numeric argument: '+key);if(p.enum&&!p.enum.includes(v))throw new Error('Invalid option: '+key);}
}
export async function runAgent({provider,model,messages,signal,emit,workspace,account,services,internet=true,timeZone='Asia/Bangkok',defaultCity='Bangkok',liveUI=[]}){
 let state=await workspace.get(account);const route=routeRequest(messages,state.projects);const history=budgetHistory(messages);const tools=toolDefinitions(state,internet,route);let calls=0;const trace=[],context=[];
 let now;try{now=new Intl.DateTimeFormat('en-CA',{timeZone,dateStyle:'full',timeStyle:'short'}).format(new Date());}catch{timeZone='Asia/Bangkok';now=new Date().toISOString();}
 const instructions=buildInstructions({now,timeZone,defaultCity,state,route,memory:state.enabled.memory!==false?retrieveMemory(state.memory,route):[],projects:state.enabled.projects!==false?selectProjects(state.projects||[],route):[],history,liveUI});
 const input=history.messages;let toolChars=0;
 for(let round=0;round<7;round++){
  signal?.throwIfAborted();emit({type:'activity',text:round?'Considering the results…':'Deciding how to help…'});
  const turn=await provider.agentTurn(input,model,tools,signal,instructions);
  if(!turn.calls.length){if(!turn.text.trim())throw new Error('The AI returned no answer. Please retry.');emit({type:'token',content:turn.text});emit({type:'done',trace,context:context.join(' | ').slice(0,12000)});return;}
  input.push(...turn.output);
  for(const call of turn.calls){
   if(++calls>12)throw new Error('This request reached the 12-tool limit. Ask a smaller follow-up to continue.');
   const name=call.name?.replace(/^jarvis\./,'');let result;const started=Date.now();
   try{
    const def=tools.find(t=>t.name===name);if(!def)throw new Error('That add-on is disabled or unavailable.');const args=typeof call.arguments==='string'?JSON.parse(call.arguments):call.arguments;validateArgs(def,args);authorizeTool(name,route.request);
    // Recheck the current enabled setting, even if it changed during this turn.
    const current=await workspace.get(account),currentDefs=toolDefinitions(current,internet);if(!currentDefs.some(t=>t.name===name))throw new Error('This add-on has been switched off.');
    emit({type:'tool',name,status:'running',arguments:args});result=await execute(name,args);if(result?.error||result?.ok===false)throw new Error(result.error||'The tool did not confirm success.');context.push(name+': '+JSON.stringify(result).slice(0,1800));trace.push({name,ok:true,ms:Date.now()-started});emit({type:'tool',name,status:'complete'});
   }catch(e){if(signal?.aborted)throw e;result={error:e.message};trace.push({name,ok:false,error:e.message,ms:Date.now()-started});emit({type:'tool',name,status:'failed',error:e.message});}
   const serialized=JSON.stringify(result);const limit=Math.max(1000,Math.min(16000,64000-toolChars));const output=serialized.length>limit?JSON.stringify({truncated:true,note:'Result excerpt only; do not infer omitted details.',preview:serialized.slice(0,limit-300)}):serialized;toolChars+=output.length;input.push({type:'function_call_output',call_id:call.call_id,output});
  }
 }
 throw new Error('The AI reached its step limit. Your completed panels are still available.');
 async function execute(name,args){
  const {images,web,weather,maps}=services;
  if(name==='show_ui'){const spec=validateUISpec(args.spec),issuedAt=Date.now();emit({type:'ui',spec,issuedAt});return {requested:true,panel_id:spec.id,title:spec.title,components:spec.components.map(c=>({id:c.id,type:c.type})),note:'The browser opens this interactive panel. Buttons and inputs operate locally. Do not claim external side effects.'};}
  if(name==='control_ui'){if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(args.panel_id)||args.component_id&&!/^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/.test(args.component_id))throw Error('Use panel and component ids from the live UI context.');emit({type:'ui_control',...args});return {requested:true,...args,note:'Operation sent to the current browser panel. The browser reports if the panel is unavailable.'};}
  if(name==='pop_out_panel'){emit({type:'ui_popout',panel:args.panel});return {requested:true,panel:args.panel};}
  if(name==='show_images'){if(args.query.length>160)throw new Error('Use a shorter image topic.');const r=await images.images(args.query,signal);emit({type:'images',...r});return {displayed:r.images.length>0,panel:'image_gallery',count:r.images.length,query:r.query,note:'The client displays the gallery and reports actual thumbnail load failures.'};}
  if(name==='show_map'){const map=await maps.lookup(args.place.slice(0,160),signal);emit({type:'map',map});return {displayed:true,place:map.title,description:map.description};}
  if(name==='show_weather'){const forecast=await weather.lookup({city:args.city.slice(0,100),day:args.day,fahrenheit:args.unit==='fahrenheit'},signal);emit({type:'weather',forecast});return {displayed:true,location:forecast.location,current:forecast.current,unit:forecast.unit,daily:forecast.daily,selectedDay:args.day};}
  if(name==='show_planner'){let startDate=args.start_date;if(!/^\d{4}-\d{2}-\d{2}$/.test(startDate)){const p=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date()).map(x=>[x.type,x.value]));startDate=`${p.year}-${p.month}-${p.day}`;}const planner={startDate,today:new Intl.DateTimeFormat('sv-SE',{timeZone}).format(new Date()),timeZone,days:7,mode:'local',synced:false};emit({type:'planner',planner});return {displayed:true,synced:false,note:'Editable local planner opened. No Google Calendar data was accessed.'};}
  if(name==='search_web'||name==='read_page'){const r=await web.lookup(name==='read_page'?{url:args.url}:{query:args.query.slice(0,300)},signal);emit({type:'references',...r});return r;}
  if(name==='show_information'){
   const query=args.query.slice(0,300),r=await web.lookup({query},signal);emit({type:'references',...r});const imagePromise=(await workspace.get(account)).enabled.images!==false?images.lookup(query.slice(0,160),signal).catch(()=>null):Promise.resolve(null);let output='',done=false;
   for await(const item of provider.chat(informationMessages([{role:'user',content:query}]),model,signal,r.references)){if(item.type==='token')output+=item.content;if(item.type==='done')done=true;}
   if(!done)throw new Error('The visual overview was interrupted.');const info=parseInformation(output,r.references.length);if(!info)throw new Error('Could not format a visual overview. Try a narrower topic.');info.image=(await imagePromise)?.references?.find(r=>r.image)?.image||null;emit({type:'information',info});return {displayed:true,panel:'information_card',imageCount:info.image?1:0,notAnImageGallery:true,...info};
  }
  if(name==='calculate'){const value=calculate(args.expression);emit({type:'result',kind:'calculation',title:'Calculation',data:value});return value;}
  if(name==='list_project_contexts'){const projects=(await workspace.get(account)).projects||[];return {projects:args.query?projects.filter(p=>p.name.toLowerCase().includes(args.query.toLowerCase())):projects.map(({name,updatedAt})=>({name,updatedAt}))};}
  if(name==='save_project_context'){const project=await workspace.action(account,{action:'saveProject',...args});emit({type:'workspace_changed'});return {saved:true,project};}
  if(name==='save_note'){const note=await workspace.action(account,{action:'saveNote',...args});emit({type:'result',kind:'note',title:note.title,data:note});emit({type:'workspace_changed'});return {saved:true,...note};}
  if(name==='find_notes'){const notes=(await workspace.get(account)).notes.filter(n=>(n.title+' '+n.content).toLowerCase().includes(args.query.toLowerCase())).slice(0,10);emit({type:'result',kind:'notes',title:'Your notes',data:notes});return {notes};}
  if(name==='remember_fact'){const memory=await workspace.action(account,{action:'remember',text:args.text});emit({type:'result',kind:'memory',title:'Saved to memory',data:memory});emit({type:'workspace_changed'});return {saved:true,...memory};}
  if(name==='list_memories'){const memory=(await workspace.get(account)).memory;emit({type:'result',kind:'memories',title:'Personal memory',data:memory});return {memory};}
  const addon=state.custom.find(a=>'addon_'+a.id===name);if(!addon)throw new Error('Unknown tool.');const url=new URL(addon.endpoint);for(const [key,value]of Object.entries(args))url.searchParams.set(key,value);const response=await publicFetch(url.href,signal,0,true);let value;try{value=JSON.parse(response.html);}catch{throw new Error('This add-on did not return valid JSON.');}emit({type:'result',kind:'addon',title:addon.name,data:value,source:response.url});return {data:value,source:response.url,untrusted:true};
 }
}
