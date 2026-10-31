import {BrowserBridge} from './browser-bridge.js';
import {Workspace} from './workspace.js';
import {runAgent} from './agent.js';
import {MapProvider} from './panels.js';
import {WeatherProvider} from './weather.js';
import {WebProvider} from './web.js';
import {ReferenceProvider} from './references.js';
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {OllamaProvider} from './ollama.js';
import {ChatGPTAuth,AuthError} from './auth.js';
import {lockRuntime} from './runtime-lock.js';
import {ChatGPTProvider} from './chatgpt.js';
import {speak,transcribe,ttsProvider,voiceStatus} from './voice.js';
const port=Number(process.env.PORT||3210),origin=`http://127.0.0.1:${port}`;
const providerName=process.env.AI_PROVIDER||'chatgpt';
if(!['chatgpt','ollama'].includes(providerName))throw new Error('AI_PROVIDER must be chatgpt or ollama');
function localURL(value){const u=new URL(value);if(u.protocol!=='http:'||!['localhost','127.0.0.1','[::1]'].includes(u.hostname))throw new Error('Voice and Ollama URLs must be local HTTP addresses');return u.origin;}
const authDir=fileURLToPath(new URL('../.local/auth/',import.meta.url));
await lockRuntime(authDir);
const auth=new ChatGPTAuth({dir:authDir,origin});
await auth.ready;
const provider=providerName==='chatgpt'?new ChatGPTProvider(auth):new OllamaProvider(localURL(process.env.OLLAMA_URL||'http://127.0.0.1:11434'),process.env.OLLAMA_MODEL||'qwen2.5:3b');
const referenceProvider=new ReferenceProvider();
const webProvider=new WebProvider();
const weatherProvider=new WeatherProvider();
const mapProvider=new MapProvider();
const bridge=new BrowserBridge(fileURLToPath(new URL('../.local/bridge/',import.meta.url)),{origins:(process.env.JARVIS_WEB_ORIGINS||'https://intouchktakizawa.github.io').split(',').map(s=>s.trim()).filter(Boolean)});
const workspace=new Workspace(fileURLToPath(new URL('../.local/workspace/',import.meta.url)));
async function workspaceAccount(){return providerName==='ollama'?'ollama-local':(await auth.status()).activeId||'guest';}
const whisper=localURL(process.env.WHISPER_URL||'http://127.0.0.1:8080');
const files={'/':['index.html','text/html'],'/app.js':['app.js','text/javascript'],'/styles.css':['styles.css','text/css'],'/doge.png':['doge.png','image/png'],'/doge.jpg':['doge.jpg','image/jpeg'],'/weather-ui.js':['weather-ui.js','text/javascript'],'/information-ui.js':['information-ui.js','text/javascript'],'/map-ui.js':['map-ui.js','text/javascript'],'/planner-ui.js':['planner-ui.js','text/javascript'],'/message-ui.js':['message-ui.js','text/javascript'],'/intents.js':['intents.js','text/javascript'],'/futuristic.css':['futuristic.css','text/css'],'/workspace-ui.js':['workspace-ui.js','text/javascript'],'/connection.js':['connection.js','text/javascript']};
const vendors={'/vendor/leaflet.js':['leaflet/dist/leaflet.js','text/javascript'],'/vendor/leaflet.css':['leaflet/dist/leaflet.css','text/css'],'/vendor/marked.js':['marked/lib/marked.esm.js','text/javascript'],'/vendor/purify.js':['dompurify/dist/purify.es.mjs','text/javascript']};
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
async function body(req,limit=256000){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>limit)throw new AuthError('Request too large','request_too_large',413);chunks.push(chunk);}return Buffer.concat(chunks);}
let accountMutation=false;const activeChats=new Set();
async function mutate(fn){if(accountMutation||activeChats.size)throw new AuthError('Stop the current reply or account operation first.','operation_in_progress',409);accountMutation=true;try{return await fn();}finally{accountMutation=false;}}
function cookie(req,name){return req.headers.cookie?.split(';').map(s=>s.trim()).find(s=>s.startsWith(name+'='))?.slice(name.length+1);}
export const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data: https://upload.wikimedia.org https://thumb.wikimedia.org https://commons.wikimedia.org https://tile.openstreetmap.org; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  const host=req.headers.host;
  if(![`127.0.0.1:${port}`,`localhost:${port}`].includes(host))return json(res,403,{error:'Invalid host'});
  const url=new URL(req.url,origin),path=url.pathname;
  if(req.method==='GET'&&host===`localhost:${port}`){res.writeHead(302,{Location:origin+url.pathname+url.search});return res.end();}
  const requestOrigin=req.headers.origin,remote=Boolean(requestOrigin&&requestOrigin!==origin);
  if(remote){
    if(!bridge.origins.has(requestOrigin))return json(res,403,{error:'This website is not allowed to access Jarvis.'});
    res.setHeader('Access-Control-Allow-Origin',requestOrigin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, X-Jarvis-Client, X-Jarvis-Pair');res.setHeader('Access-Control-Allow-Private-Network','true');
    if(req.method==='OPTIONS'){res.writeHead(204);return res.end();}
    if(path.startsWith('/api/auth/')||path==='/api/bridge/code'||path==='/api/bridge/devices'||path==='/api/bridge/revoke')return json(res,403,{error:'Manage sign-in and paired browsers in the local Jarvis app.'});
    if(path!=='/api/bridge/pair'&&!await bridge.authorized(req.headers['x-jarvis-pair'],requestOrigin,await workspaceAccount()))return json(res,401,{error:'Pair this browser with the local Jarvis app first.'});
  }
  if(req.method==='POST'&&req.headers['x-jarvis-client']!=='1')return json(res,403,{error:'Only the JARVIS app can access this endpoint'});
  const controller=new AbortController();res.on('close',()=>controller.abort());
  try{
    if(req.method==='POST'&&path==='/api/bridge/code')return json(res,200,bridge.code(await workspaceAccount()));
    if(req.method==='GET'&&path==='/api/bridge/devices')return json(res,200,{devices:await bridge.list(await workspaceAccount())});
    if(req.method==='POST'&&path==='/api/bridge/revoke'){const{id}=JSON.parse(await body(req));await bridge.revoke(id,await workspaceAccount());return json(res,200,{ok:true});}
    if(req.method==='POST'&&path==='/api/bridge/pair'){if(!remote)return json(res,400,{error:'Pair from the GitHub Pages website.'});const data=JSON.parse(await body(req,2000));return json(res,200,await bridge.pair({...data,origin:requestOrigin,account:await workspaceAccount()}));}
    if(req.method==='GET'&&vendors[path]){const[name,type]=vendors[path];res.writeHead(200,{'Content-Type':type});return res.end(await readFile(fileURLToPath(new URL(`../node_modules/${name}`,import.meta.url))));}
    if(req.method==='GET'&&files[path]){const[name,type]=files[path];res.writeHead(200,{'Content-Type':type});return res.end(await readFile(fileURLToPath(new URL(`../public/${name}`,import.meta.url))));}
    if(req.method==='GET'&&path==='/auth/callback'){
      try{await mutate(()=>auth.callback(url.searchParams,cookie(req,'jarvis_oauth')));res.setHeader('Set-Cookie','jarvis_oauth=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');res.writeHead(303,{Location:'/?signin=complete'});}
      catch(e){res.writeHead(303,{Location:'/?signin=failed'});}return res.end();
    }
    if(req.method==='POST'&&path==='/api/auth/start'){
      const {accountId}=JSON.parse(await body(req));const binding=randomBytes(32).toString('base64url');
      const authUrl=await mutate(()=>auth.start(accountId,binding));res.setHeader('Set-Cookie',`jarvis_oauth=${binding}; HttpOnly; SameSite=Lax; Path=/; Max-Age=600`);return json(res,200,{authUrl});
    }
    if(req.method==='POST'&&path==='/api/auth/resume'){const authUrl=await auth.resume(cookie(req,'jarvis_oauth'));return json(res,200,{authUrl});}
    if(req.method==='POST'&&path==='/api/auth/cancel'){await mutate(()=>auth.cancel());return json(res,200,{ok:true});}
    if(req.method==='POST'&&path==='/api/auth/select'){const{id}=JSON.parse(await body(req));await mutate(()=>auth.select(id));return json(res,200,{ok:true});}
    if(req.method==='POST'&&path==='/api/auth/logout'){const result=await mutate(()=>auth.logout());return json(res,200,result);}
    if(req.method==='POST'&&path==='/api/auth/welcome'){await auth.welcome();return json(res,200,{ok:true});}
    if(req.method==='GET'&&path==='/api/status'){
      const authState=await auth.status();let models=[],error=null;
      try{if(providerName==='ollama')models=(await provider.models()).map(id=>({id,name:id}));else if(authState.signedIn&&authState.planEnabled)models=await provider.models();}catch(e){error={message:e.message,code:e.code,status:e.status,requestId:e.requestId};}
      const stt=await fetch(whisper,{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);
      return json(res,200,{provider:providerName,connected:models.length>0,auth:authState,models,defaultModel:providerName==='ollama'?provider.model:'gpt-6-luna',error,stt,tts:await voiceStatus(),ttsProvider});
    }
    if(req.method==='GET'&&path==='/api/workspace')return json(res,200,await workspace.overview(await workspaceAccount()));
    if(req.method==='POST'&&path==='/api/workspace'){const data=JSON.parse(await body(req,1600000));const account=await workspaceAccount();if(data.expectedAccount&&data.expectedAccount!==account)throw new AuthError('The account changed. Open this workspace again.','account_changed',409);return json(res,200,await workspace.action(account,data));}
    if(req.method==='POST'&&path==='/api/images'){if((await workspace.get(await workspaceAccount())).enabled.images===false)throw new AuthError('The image add-on is switched off. Enable it in Add-ons.','addon_disabled',409);const{query}=JSON.parse(await body(req));if(typeof query!=='string'||!query.trim()||query.length>160)throw new AuthError('Enter a topic up to 160 characters.','invalid_query',400);return json(res,200,await referenceProvider.images(query,controller.signal));}
    if(req.method==='POST'&&path==='/api/discover'){const{query}=JSON.parse(await body(req));if(typeof query!=='string'||query.length>160)throw new AuthError('Use a short public topic, up to 160 characters.','invalid_query',400);return json(res,200,await referenceProvider.lookup(query,controller.signal));}
    if(req.method==='POST'&&path==='/api/chat'){
      if(accountMutation)throw new AuthError('Wait for the account operation to finish.','auth_busy',409);
      const data=JSON.parse(await body(req));
      if(!Array.isArray(data.messages)||!data.messages.length||data.messages.length>80||data.messages.some(m=>!m||!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>32000)||data.messages.at(-1).role!=='user')return json(res,400,{error:'Invalid conversation'});
      if(typeof data.model!=='string'||!data.model||data.model.length>160)return json(res,400,{error:'Choose a valid model'});
      if(providerName==='chatgpt'){const s=await auth.status();if(s.pending)throw new AuthError('Finish or cancel sign-in before chatting.','auth_busy',409);if(!s.signedIn||!s.planEnabled)throw new AuthError('Continue with ChatGPT and enable plan usage before chatting.');}
      activeChats.add(controller);res.writeHead(200,{'Content-Type':'application/x-ndjson'});res.flushHeaders();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(180000)]);
      try{
        await runAgent({provider,model:data.model,messages:data.messages,signal,emit:event=>{if(!res.destroyed)res.write(JSON.stringify(event)+'\n');},workspace,account:await workspaceAccount(),services:{images:referenceProvider,web:webProvider,weather:weatherProvider,maps:mapProvider},internet:data.webSearch!==false,defaultCity:process.env.WEATHER_CITY||'Bangkok',timeZone:typeof data.timeZone==='string'?data.timeZone:'Asia/Bangkok'});
      }
      catch(e){if(!res.destroyed)res.write(JSON.stringify({type:'error',error:e.message,code:e.code,status:e.status,requestId:e.requestId})+'\n');}
      finally{activeChats.delete(controller);}return res.end();
    }
    if(req.method==='POST'&&path==='/api/transcribe'){const wav=await body(req,2200000);if(wav.toString('ascii',0,4)!=='RIFF'||wav.toString('ascii',8,12)!=='WAVE')return json(res,400,{error:'Expected WAV audio'});return json(res,200,{text:await transcribe(wav,whisper,AbortSignal.any([controller.signal,AbortSignal.timeout(90000)]))});}
    if(req.method==='POST'&&path==='/api/speak'){const{text}=JSON.parse(await body(req));if(typeof text!=='string'||!text.trim()||text.length>5000)return json(res,400,{error:'Speech must be 1–5000 characters'});const audio=await speak(text,controller.signal);res.writeHead(200,{'Content-Type':'audio/wav'});return res.end(audio);}
    json(res,404,{error:'Not found'});
  }catch(e){if(!res.headersSent)json(res,e.status||400,{error:e.message,code:e.code});else res.end();}
});
server.listen(port,'127.0.0.1',()=>console.log(`Kenta's JARVIS → ${origin} (${providerName})`));

for(const signal of ['SIGTERM','SIGINT'])process.once(signal,()=>{for(const c of activeChats)c.abort();server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),2000).unref();});
