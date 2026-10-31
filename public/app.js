import {apiFetch,isHosted,initConnection} from './connection.js';
import {initWorkspace,renderResult} from './workspace-ui.js';
import {renderMessage} from './message-ui.js';
import {renderMap} from './map-ui.js';
import {renderPlanner} from './planner-ui.js';
import {renderWeather} from './weather-ui.js';
import {renderInformation} from './information-ui.js';
const $=s=>document.querySelector(s);
const micIcon=$('#mic').innerHTML;
const welcomeTemplate=$('#welcome').cloneNode(true);let visualContext=true,scrollFrame=null,followOutput=true;
const connection=initConnection();
let authPolling=null,authWorking=false,activeAccount=null;
let liveMode=false,liveTimer=null;
let transcript=[],conversationId=null,restoring=false,workspaceUI;
let history=[],status={},busy=false,controller,audio,audioURL,speechController,speechEpoch=0,recording=null,recordStarting=false;
const states={idle:['READY WHEN YOU ARE','Right here, Kenta.','Talk naturally. I’ll take it from here.'],offline:['LET’S CONNECT','Your copilot is here.','Connect your intelligence in Settings to start chatting.'],thinking:['THINKING','On it.','Give me a moment to think this through.'],listening:['LISTENING','Go ahead. I’m listening.','Click the microphone again to finish.'],transcribing:['TRANSCRIBING','Turning voice into thought.','Processing your recording with whisper.cpp.'],speaking:['SPEAKING','A thought, out loud.','Your local assistant is speaking.']};
function state(name){document.body.dataset.state=name;$('#talk-label').textContent=name==='listening'?'Finish recording':name==='transcribing'?'Transcribing…':name==='thinking'?'Thinking…':'Talk to JARVIS';$('#voice-stop').hidden=name!=='speaking';const s=states[name];$('#state').textContent=s[0];$('#hud-state').textContent=s[0];$('#state-title').textContent=s[1];$('#state-detail').textContent=s[2];}
function rest(){state(status.connected?'idle':'offline');}
function notice(text=''){$('#notice').textContent=text;}
function log(text){const li=document.createElement('li');li.textContent=text;const t=document.createElement('time');t.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});li.append(t);$('#activity').prepend(li);while($('#activity').children.length>12)$('#activity').lastChild.remove();}
function clock(){$('#clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})+' / LOCAL';}clock();setInterval(clock,1000);
for(let i=0;i<39;i++){const bar=document.createElement('i');bar.style.setProperty('--h',`${5+Math.sin(i*.7)**2*20}px`);bar.style.setProperty('--delay',`${i%7*.1}s`);$('.wave').append(bar);}
async function refresh({quiet=false}={}){
  $('#refresh').disabled=true;
  try{const response=await apiFetch('/api/status');if(!response.ok)throw new Error('App connection unavailable');const next=await response.json();
    if(activeAccount&&activeAccount!==next.auth.activeId){history=[];transcript=[];conversationId=null;disposePanels();$('#messages').replaceChildren();message('assistant','Account changed. A fresh conversation is ready.');}
    activeAccount=next.auth.activeId;status=next;document.body.dataset.connected=String(status.connected);
    const selectedAccount=$('#account').value;const current=$('#model').value;$('#model').replaceChildren();
    for(const model of status.models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;$('#model').append(option);}
    if(!status.models.length){const option=document.createElement('option');option.textContent='Connect to load models';option.value='';$('#model').append(option);}
    $('#model').value=status.models.some(m=>m.id===current)?current:status.models.some(m=>m.id===status.defaultModel)?status.defaultModel:$('#model').options[0].value;
    const cloud=status.provider==='chatgpt',auth=status.auth;
    $('.privacy').textContent=cloud?'YOUR ACCOUNT · LOCAL VOICE':'LOCAL AI · LOCAL VOICE';$('#model-short').textContent=$('#model').value||'Connect a model';$('.core-bottom span').textContent=cloud?'CHATGPT INFERENCE':'ON-DEVICE PROCESSING';$('.local-note p').textContent=cloud?'Chat uses your ChatGPT plan with OpenAI. Speech recognition and voice synthesis run on this Mac.':'Chat and speech run on your machine using Ollama, whisper.cpp, and local TTS.';$('#connect-banner').hidden=!cloud||(auth.signedIn&&auth.planEnabled);$('#connect').textContent=auth.pending?'Continue sign-in ↗':'Continue with ChatGPT';$('#account-card').hidden=!cloud;$('#intelligence-label').textContent=cloud?'ChatGPT intelligence':'Local intelligence';
    $('#ollama-state').textContent=cloud?(status.connected?'Connected · ChatGPT plan':auth.signedIn?(auth.planEnabled?'Signed in · models unavailable':'Plan permission required'):'Not signed in'):status.connected?'Ollama · on this device':'Ollama offline';
    $('#auth-summary').textContent=auth.pending?'A sign-in is waiting. Continue below, or cancel to start again.':auth.signedIn?(auth.planEnabled?'Your ChatGPT plan is connected.':'Signed in. Enable plan usage to chat.'):'Use your ChatGPT plan. No API key needed.';
    $('#account').replaceChildren();
    for(const account of auth.accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.label;$('#account').append(option);}
    const add=document.createElement('option');add.value='new';add.textContent='Add another ChatGPT account';$('#account').append(add);$('#account').value=selectedAccount==='new'?'new':auth.activeId||'new';
    $('#sign-in').textContent=auth.pending?'Continue sign-in ↗':auth.signedIn&&auth.planEnabled?'Sign in again with ChatGPT':'Continue with ChatGPT';
    $('#sign-out').hidden=!auth.signedIn;$('#cancel-login').hidden=!auth.pending;$('#plan-indicator').hidden=!cloud||!auth.signedIn||!auth.planEnabled;
    if(!auth.pending){$('#sign-in-link').hidden=true;clearInterval(authPolling);authPolling=null;}
    if(auth.welcomeRequired&&auth.planEnabled&&!$('#plan-welcome').open){$('#settings').close();$('#plan-welcome').showModal();}
    $('#stt-state').textContent=status.stt?'whisper.cpp · ready':'Not running · see setup guide';
    $('#tts-state').textContent=status.tts?(status.ttsProvider==='macos'?'macOS · British English':'Piper · local voice'):'Not configured';
    for(const[id,ok]of [['ollama',status.connected],['stt',status.stt],['tts',status.tts]])$(`#${id}-dot`).classList.toggle('ok',Boolean(ok));
    $('#test-voice').disabled=!status.tts;$('#auto-speak').disabled=liveMode||!status.tts;updateControls();if(!busy&&!recording&&!speechController)rest();
    if(!quiet)log(status.connected?'Intelligence connection checked':'Waiting for intelligence connection');
    if(status.error)notice(status.error.message);else if(auth.error)notice(auth.error);else if(auth.pending)notice('Use Continue sign-in above to reopen OpenAI, or cancel in Settings.');else if(cloud&&!auth.signedIn)notice();else if(cloud&&!auth.planEnabled)notice('Sign in again and enable ChatGPT plan usage.');else if(!quiet)notice();
  }catch(e){notice(e.message);if(!quiet)log('Connection check failed');}finally{$('#refresh').disabled=false;}
}
function updateControls(){
 $('#memory-count').textContent=String(Math.ceil(history.length/2)).padStart(2,'0')+' / 39';
  $('#send').disabled=busy||!!recording||recordStarting||authWorking||status.auth?.pending||!status.connected;$('#model').disabled=busy||!status.connected;
  $('#clear').disabled=busy||!!recording||liveMode;$('#mic').disabled=(busy&&!recording)||recordStarting;$('#stop').hidden=!busy;$('#send').hidden=busy;
  for(const id of ['connect','sign-in'])$('#'+id).disabled=busy||!!recording||authWorking;for(const id of ['sign-out','account'])$('#'+id).disabled=busy||!!recording||authWorking||Boolean(status.auth?.pending);
  $('#cancel-login').disabled=authWorking;$('#talk').disabled=$('#mic').disabled;$('#visual-context').disabled=busy;
}
async function authAction(path,data={}){const response=await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
$('#sign-in').addEventListener('click',async()=>{
  if(isHosted){connection.open();notice('Sign in using the local Jarvis app, then refresh this page.');return;}
  if(authWorking||busy||recording)return;
  stopSpeech();authWorking=true;updateControls();$('#auth-feedback').textContent='Opening OpenAI sign-in…';
  try{
    const accountId=$('#account').value;
    const result=status.auth?.pending?await authAction('/api/auth/resume'):await authAction('/api/auth/start',{accountId:accountId==='new'?null:accountId});
    const url=new URL(result.authUrl);if(url.origin!=='https://auth.openai.com')throw new Error('Unexpected sign-in destination.');
    const link=$('#sign-in-link');link.href=url.href;link.hidden=false;
    log('Opening official ChatGPT sign-in');
    window.location.assign(url.href);
  }catch(e){$('#auth-feedback').textContent=e.message;notice(e.message);await refresh({quiet:true});}
  finally{authWorking=false;updateControls();}
});
$('#connect').addEventListener('click',()=>$('#sign-in').click());
$('#settings-open').addEventListener('click',()=>$('#settings').showModal());
$('#model-short').addEventListener('click',()=>$('#settings').showModal());
$('#view-toggle').addEventListener('click',()=>{const voice=document.body.dataset.view!=='voice';document.body.dataset.view=voice?'voice':'chat';$('#view-toggle').setAttribute('aria-pressed',String(voice));$('#view-toggle').setAttribute('aria-label',voice?'Switch to chat view':'Switch to voice view');});
$('#visual-context').addEventListener('click',()=>{visualContext=!visualContext;$('#visual-context').setAttribute('aria-pressed',String(visualContext));notice(visualContext?'Internet on: Jarvis can search public topics and read public HTTPS pages.':'Internet off. Replies use the model’s knowledge. Direct image search is still available.');});
$('#context-about').addEventListener('click',()=>{$('#settings').showModal();$('#context-info').open=true;$('#context-info').scrollIntoView({block:'center',behavior:'smooth'});});
$('#messages').addEventListener('scroll',()=>{const m=$('#messages');followOutput=m.scrollHeight-m.scrollTop-m.clientHeight<100;},{passive:true});
$('#memory-status').addEventListener('click',()=>workspaceUI.open('memory'));
$('#workbench-open').addEventListener('click',()=>workspaceUI.open('addons'));
$('#settings-close').addEventListener('click',()=>$('#settings').close());
$('#talk').addEventListener('click',()=>$('#mic').click());
$('#voice-stop').addEventListener('click',()=>{stopSpeech();rest();queueListen();});
$('#cancel-login').addEventListener('click',async()=>{try{await authAction('/api/auth/cancel');$('#auth-feedback').textContent='Sign-in cancelled. You can start again.';notice('Sign-in cancelled.');await refresh({quiet:true});}catch(e){notice(e.message);}});
$('#sign-out').addEventListener('click',async()=>{authWorking=true;updateControls();stopSpeech();try{const result=await authAction('/api/auth/logout');history=[];transcript=[];conversationId=null;disposePanels();$('#messages').replaceChildren();message('assistant','Signed out. Your next session will start fresh.');await refresh({quiet:true});notice(result.message);log('ChatGPT signed out');}catch(e){notice(e.message);}finally{authWorking=false;updateControls();}});
$('#account').addEventListener('change',async()=>{if($('#account').value==='new'){notice('Click Continue with ChatGPT to add this account.');return;}authWorking=true;updateControls();stopSpeech();try{await authAction('/api/auth/select',{id:$('#account').value});await refresh({quiet:true});}catch(e){notice(e.message);}finally{authWorking=false;updateControls();}});
$('#welcome-dismiss').addEventListener('click',async()=>{try{await authAction('/api/auth/welcome');$('#plan-welcome').close();}catch(e){notice(e.message);}});
function message(role,text){const record=restoring?null:{role,text,events:[]};if(record)transcript.push(record);document.body.dataset.conversation='true';$('#welcome')?.remove();followOutput=true;const el=document.createElement('article');el.className=`message ${role}`;const label=document.createElement('div');label.className='message-label';label.textContent=role==='user'?'KENTA':'JARVIS';const content=document.createElement('div');content.className='message-content';content.textContent=text;el.append(label,content);$('#messages').append(el);scroll();return {el,content,record};}
function revealVisual(reply){followOutput=false;requestAnimationFrame(()=>{const m=$('#messages');m.scrollTop+=reply.el.getBoundingClientRect().top-m.getBoundingClientRect().top-10;});}
function scroll(){if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;$('#memory-count').textContent=String(Math.ceil(history.length/2)).padStart(2,'0')+' / 39';$('#message-count').textContent=$('#messages').querySelectorAll('.message').length;if(followOutput)$('#messages').scrollTop=$('#messages').scrollHeight;});}
function webSourceURL(value){try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function sourceURL(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&hosts.includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function link(text,url){const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function renderReferences(references,reply){
 const tray=document.createElement('div');tray.className='reference-tray';let count=0;
 for(const [index,reference] of references.slice(0,5).entries()){
  const url=reference.kind==='web'?webSourceURL(reference.url):sourceURL(reference.url,['en.wikipedia.org']);if(!url)continue;count++;
  const card=document.createElement('article');card.className='reference-card';
  const image=reference.image,src=sourceURL(image?.url,['upload.wikimedia.org','thumb.wikimedia.org']),credit=sourceURL(image?.creditURL,['commons.wikimedia.org']);
  if(src&&credit&&image.license){const img=document.createElement('img');img.src=src;img.alt=image.alt||reference.title;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove(),{once:true});card.append(img);}
  const copy=document.createElement('div');copy.className='reference-copy';const label=document.createElement('div');label.className='source-label';label.textContent=reference.kind==='web'?`[${index+1}] ${new URL(url).hostname.replace(/^www\./,'')} · ${reference.read?'PAGE READ':'SEARCH RESULT'}`:`[${index+1}] WIKIPEDIA`;const title=document.createElement('h3');title.textContent=reference.title;const extract=document.createElement('p');extract.textContent=reference.extract.slice(0,220)+(reference.extract.length>220?'…':'');copy.append(label,title,extract,link('Read source ↗',url));card.append(copy);
  if(src&&credit&&image.license){const attribution=document.createElement('div');attribution.className='image-credit';const artist=document.createElement('span');artist.textContent=image.artist;attribution.append(artist,link(`Image · ${image.license} ↗`,credit));card.append(attribution);}
  tray.append(card);
 }
 if(count){const details=document.createElement('details');details.className='source-details';const summary=document.createElement('summary');summary.textContent=`Sources · ${count}`;details.append(summary,tray);reply.el.append(details);}scroll();
}

function renderImages(images,reply){
 const gallery=document.createElement('div');gallery.className='image-gallery';reply.hasGallery=true;let loaded=0,settled=0;const update=()=>{reply.content.textContent=loaded?`${loaded} image${loaded===1?'':'s'} loaded. Select one to enlarge.`:settled>=gallery.children.length?'The image previews could not load. Try another search.':'Loading image previews…';};
 for(const image of images.slice(0,6)){
  const src=sourceURL(image.url,['upload.wikimedia.org','thumb.wikimedia.org']),credit=sourceURL(image.creditURL,['commons.wikimedia.org']);if(!src||!credit)continue;
  const figure=document.createElement('figure');figure.className='web-image';const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Enlarge '+image.alt);
  const img=document.createElement('img');img.src=src;img.alt=image.alt;img.loading='lazy';img.referrerPolicy='no-referrer';img.addEventListener('load',()=>{loaded++;settled++;update();},{once:true});img.addEventListener('error',()=>{settled++;button.disabled=true;button.textContent='Image unavailable';button.classList.add('image-error');update();},{once:true});button.append(img);
  button.addEventListener('click',()=>{$('#image-full').src=src;$('#image-full').alt=image.alt;$('#image-caption').textContent=image.alt+' · '+image.artist+' · '+image.license;$('#image-source').href=credit;$('#image-viewer').showModal();});
  const caption=document.createElement('figcaption'),title=document.createElement('strong');title.textContent=image.alt;caption.append(title,link(image.license+' · Source ↗',credit));figure.append(button,caption);gallery.append(figure);
 }
 reply.el.insertBefore(gallery,reply.content);reply.content.textContent=gallery.children.length?'Loading image previews…':'No image previews were found. Try a more specific topic.';scroll();
}
async function discoverTopic(topic,original){
 if(busy||recording||recordStarting)return;if(history.length>=78){notice('Conversation is full. Start a new conversation to continue.');return;}stopSpeech();busy=true;controller=new AbortController();updateControls();document.body.dataset.view='chat';$('#view-toggle').setAttribute('aria-pressed','false');const requestText=original||`Show me images of ${topic}`;message('user',requestText);const reply=message('assistant','Searching for images…');reply.content.classList.add('lookup-loader');state('thinking');notice();
 try{const r=await apiFetch('/api/images',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:topic}),signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);reply.content.classList.remove('lookup-loader');reply.content.textContent=data.images.length?`Here’s what I found for “${data.query}”. Click an image for a closer look.`:'No images found. Try a simpler or more specific topic.';renderImages(data.images,reply);revealVisual(reply);reply.record.text=`Image gallery: ${data.query}`;reply.record.events.push({type:'images',images:data.images,query:data.query});history.push({role:'user',content:requestText},{role:'assistant',content:`Displayed ${data.images.length} images of ${data.query} in an inline gallery.`});saveConversation();log(`Image search: ${data.query}`);}
 catch(e){reply.content.classList.remove('lookup-loader');reply.content.textContent=e.name==='AbortError'?'Search stopped.':`Image search unavailable: ${e.message}`;if(e.name!=='AbortError'){const search=new URL('https://commons.wikimedia.org/w/index.php');search.search=new URLSearchParams({search:topic,title:'Special:MediaSearch',type:'image'});reply.el.append(link('Search Wikimedia Commons ↗',search.href));}if(liveMode)endLive();}
 finally{busy=false;controller=null;updateControls();rest();scroll();if(liveMode)queueListen();}
}
$('#image-search').addEventListener('click',()=>{if(liveMode)endLive();$('#image-query').value=$('#prompt').value.trim().slice(0,160);$('#image-search-dialog').showModal();$('#image-query').focus();});
$('#image-search-close').addEventListener('click',()=>$('#image-search-dialog').close());
$('#image-search-form').addEventListener('submit',e=>{e.preventDefault();const q=$('#image-query').value.trim();if(!q)return;$('#image-search-dialog').close();discoverTopic(q);});
$('#image-close').addEventListener('click',()=>$('#image-viewer').close());
$('#prompt').addEventListener('input',updateControls);
function queueListen(){clearTimeout(liveTimer);if(liveMode)liveTimer=setTimeout(()=>{if(liveMode&&!busy&&!recording&&!recordStarting&&!speechController)$('#mic').click();},600);}
function endLive(){liveMode=false;$('#live-end').hidden=true;clearTimeout(liveTimer);$('#live').setAttribute('aria-pressed','false');$('#live').lastChild.textContent=' Start live voice';$('#auto-speak').disabled=!status.tts;if(recording){recording.discard=true;finishRecording();}stopSpeech();if(!busy)rest();}
$('#live-end').addEventListener('click',()=>{endLive();notice('Live voice stopped.');});
$('#live').addEventListener('click',()=>{
 if(liveMode){endLive();notice('Live voice stopped.');return;}
 if(busy||recording||recordStarting)return;
 if(!status.connected||!status.stt||!status.tts){notice('Live voice needs a connected model, local microphone recognition, and a local voice. Check Connections & voice.');$('#settings').showModal();return;}
 liveMode=true;$('#live-end').hidden=false;$('#live').setAttribute('aria-pressed','true');$('#live').lastChild.textContent=' End live voice';$('#auto-speak').checked=true;$('#auto-speak').disabled=true;notice('Live voice is on. Speak, then pause to send. Use End live voice or Escape to stop.');queueListen();
});
function disposePanels(){for(const el of $('#messages').querySelectorAll('.map-card,.planner-card'))el.dispatchEvent(new Event('jarvis-dispose'));}
function stopSpeech(){$('#test-voice').textContent='Preview assistant voice ▷';$('#voice-stop').hidden=true;speechEpoch++;speechController?.abort();speechController=null;if(audio){audio.pause();audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}}
async function speak(text){stopSpeech();const epoch=speechEpoch; speechController=new AbortController();$('#test-voice').textContent='Stop voice ■';state('speaking');log('Synthesising local speech');try{const response=await apiFetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,5000)}),signal:speechController.signal});if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob();if(epoch!==speechEpoch)return;audioURL=URL.createObjectURL(blob);audio=new Audio(audioURL);audio.onended=()=>{stopSpeech();rest();queueListen();};await audio.play();log('Playing assistant voice');}catch(e){if(epoch!==speechEpoch)return;if(liveMode)endLive();notice(e.name==='NotAllowedError'?'Click a reply’s “Listen” button to allow audio playback.':e.message);stopSpeech();rest();}}
async function send(){const text=$('#prompt').value.trim();if(!text||busy||recording||authWorking||status.auth?.pending)return;if(!status.connected){notice('Connect your intelligence account and select a model before sending.');return;}
  if(history.length>=78){notice('Conversation is full. Start a new conversation to continue.');return;}
  stopSpeech();notice();busy=true;updateControls();$('#prompt').value='';history.push({role:'user',content:text});message('user',text);const reply=message('assistant','');controller=new AbortController();let output='',complete=false,toolContext='';state('thinking');log(`Prompt sent to ${$('#model').value}`);
  try{const response=await apiFetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,model:$('#model').value,visualContext,webSearch:visualContext,timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone}),signal:controller.signal});if(!response.ok)throw new Error((await response.json()).error);const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.error);if(['images','map','planner','weather','information','references','result','tool'].includes(event.type))applyPanelEvent(event,reply);if(event.type==='workspace_changed')workspaceUI.refresh().catch(()=>{});if(event.type==='activity'){log(event.text);$('#state-detail').textContent=event.text;}if(event.type==='warning'){notice(event.text);log(event.text);}if(event.type==='token'){output+=event.content;if(!reply.frame)reply.frame=requestAnimationFrame(()=>{reply.frame=null;if(!reply.hasGallery)renderMessage(reply.content,output);scroll();});}if(event.type==='done'){complete=true;toolContext=event.context||'';}}}
    if(!complete)throw new Error('Response was interrupted. Please retry.');if(!output.trim())throw new Error('The model returned no text. Try another prompt or model.');
    if(reply.frame)cancelAnimationFrame(reply.frame);reply.frame=null;if(!reply.hasGallery)renderMessage(reply.content,output);reply.record.text=output;history.push({role:'assistant',content:output+(toolContext?'\n\n[Completed tools: '+toolContext+']':'')});saveConversation();log('Response complete');const listen=document.createElement('button');listen.className='replay';listen.textContent='▷ Listen';listen.addEventListener('click',()=>{if(!busy&&!recording)speak(output);});reply.el.append(listen);
  }catch(e){if(reply.frame)cancelAnimationFrame(reply.frame);reply.frame=null;complete=false;history.pop();reply.el.classList.add('failed');reply.record.text=output||'Response failed.';reply.content.textContent=(output?output+'\n\n':'')+(e.name==='AbortError'?'Response stopped.':e.message);if(liveMode)endLive();log(e.name==='AbortError'?'Response stopped':'Response failed');notice('Your prompt is back in the composer so you can retry.');$('#prompt').value=text;}
  finally{busy=false;controller=null;updateControls();rest();$('#prompt').focus();}
  if(complete&&output&&$('#auto-speak').checked)await speak(output);
}
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();send();});$('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
$('#stop').addEventListener('click',()=>{if(liveMode)endLive();controller?.abort();});$('#refresh').addEventListener('click',()=>refresh());
$('#clear').addEventListener('click',()=>{try{localStorage.removeItem('jarvis.activeChat.'+(activeAccount||'local'));}catch{}stopSpeech();history=[];transcript=[];conversationId=null;disposePanels();$('#messages').replaceChildren();document.body.dataset.conversation='false';$('#hero-welcome').replaceChildren(welcomeTemplate.cloneNode(true));$('#prompt').value='';notice();rest();log('New conversation started');scroll();});
document.addEventListener('click',e=>{const panel=e.target.closest('[data-panel]');if(panel){$('#prompt').value=panel.dataset.panel==='map'?'Show me a map of Thailand':'Show my calendar for the next 7 days';send();return;}const topic=e.target.closest('[data-images]');if(topic){discoverTopic(topic.dataset.images);return;}const button=e.target.closest('[data-prompt]');if(button){$('#prompt').value=button.dataset.prompt;$('#prompt').focus();}});
$('#test-voice').addEventListener('click',()=>{if(speechController){stopSpeech();rest();return;}if(!busy&&!recording)speak('Good evening, Kenta. Your assistant is ready. What shall we work on?');});
$('#auto-speak').addEventListener('change',()=>{if(!$('#auto-speak').checked){stopSpeech();if(!busy&&!recording)rest();}});
// Capture PCM directly: no cloud speech recognition, codecs, or ffmpeg required.
function wav(samples,rate){const length=Math.floor(samples.length*16000/rate);const buffer=new ArrayBuffer(44+length*2),v=new DataView(buffer);const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){const start=Math.floor(i*rate/16000),end=Math.max(start+1,Math.floor((i+1)*rate/16000));let sum=0;for(let j=start;j<Math.min(end,samples.length);j++)sum+=samples[j];const x=Math.max(-1,Math.min(1,sum/(end-start)));v.setInt16(44+i*2,x<0?x*32768:x*32767,true);}return buffer;}
async function finishRecording(){const r=recording;if(!r)return;recording=null;clearTimeout(r.timer);r.processor.disconnect();r.source.disconnect();r.mute.disconnect();r.stream.getTracks().forEach(t=>t.stop());await r.ctx.close();$('#mic').innerHTML=micIcon;$('#mic').setAttribute('aria-label','Start recording');$('#mic').setAttribute('aria-pressed','false');document.body.style.setProperty('--level','0');if(r.discard){updateControls();rest();return;}busy=true;controller=new AbortController();updateControls();state('transcribing');
  try{const samples=new Float32Array(r.chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of r.chunks){samples.set(c,offset);offset+=c.length;}if(samples.length<r.rate*.25)throw new Error('Recording was too short. Please try again.');const response=await apiFetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav(samples,r.rate),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);$('#prompt').value=data.text;notice(data.text?(liveMode?'':'Transcript ready. Review it, then press Send.'):'No speech detected. Please try again.');log('Local transcription complete');$('#prompt').focus();}catch(e){notice(e.name==='AbortError'?'Transcription stopped.':`Speech recognition: ${e.message}`);if(liveMode)endLive();log('Transcription ended');}finally{controller=null;busy=false;updateControls();rest();}if(liveMode){if($('#prompt').value.trim())await send();else queueListen();}}
$('#mic').addEventListener('click',async()=>{if(recording)return finishRecording();if(busy||recordStarting)return;if(!status.stt){if(liveMode)endLive();notice('Microphone recognition is offline. Start whisper-server, then refresh connections in Settings.');$('#settings').showModal();return;}stopSpeech();recordStarting=true;updateControls();let stream,ctx;try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});ctx=new AudioContext();await ctx.resume();const source=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),mute=ctx.createGain();mute.gain.value=0;const r={stream,ctx,source,processor,mute,chunks:[],rate:ctx.sampleRate};recording=r;processor.onaudioprocess=e=>{if(recording!==r)return;const samples=new Float32Array(e.inputBuffer.getChannelData(0));r.chunks.push(samples);let power=0;for(const s of samples)power+=s*s;const level=Math.sqrt(power/samples.length);document.body.style.setProperty('--level',Math.min(1,level*8));if(liveMode){const now=performance.now();if(level>.018){r.heard=true;r.lastVoice=now;}else if(r.heard&&now-r.lastVoice>1500)finishRecording();}};source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);r.timer=setTimeout(finishRecording,45000);$('#mic').textContent='■';$('#mic').setAttribute('aria-label','Finish recording');$('#mic').setAttribute('aria-pressed','true');notice('Recording locally · maximum 45 seconds. Click ■ to finish.');state('listening');log('Microphone opened · local capture');}catch(e){stream?.getTracks().forEach(t=>t.stop());if(ctx)await ctx.close();if(liveMode)endLive();notice(`Microphone: ${e.message}`);rest();}finally{recordStarting=false;updateControls();}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){if(liveMode)endLive();controller?.abort();stopSpeech();if(!busy&&!recording)rest();}});
window.addEventListener('pagehide',()=>{liveMode=false;clearTimeout(liveTimer);clearInterval(authPolling);stopSpeech();recording?.stream.getTracks().forEach(t=>t.stop());recording?.ctx.close();controller?.abort();});
if(new URLSearchParams(location.search).has('signin')){window.history.replaceState(null,'','/');}
workspaceUI=initWorkspace({api:apiFetch,getAccount:()=>activeAccount,onResume:restoreConversation,onDelete:id=>{if(id===conversationId)$('#clear').click();}});
log('Workspace initialised');refresh().then(async()=>{
 try{await workspaceUI.refresh();}catch(e){notice(e.message);}
 const params=new URLSearchParams(location.search),panel=params.get('panel');
 if(['addons','chats','memory','notes'].includes(params.get('workspace')))workspaceUI.open(params.get('workspace'));
 if(['map','calendar','images'].includes(panel)){$('#prompt').value=panel==='images'?`Show images of ${(params.get('topic')||'dogs').slice(0,160)}`:panel==='map'?'Show me a map of Thailand':'Show my calendar for the next 7 days';window.history.replaceState(null,'','/?v=agent');send();return;}
 try{const id=localStorage.getItem('jarvis.activeChat.'+(activeAccount||'local'));if(id){const chat=await workspaceUI.action({action:'getChat',id});if(chat)restoreConversation(chat);}}catch(e){notice('Your saved conversation could not be restored: '+e.message);}
});

function applyPanelEvent(event,reply){
 if(reply.record&&!restoring)reply.record.events.push(event);
 if(event.type==='tool'){
  if(!reply.tools){reply.tools=document.createElement('div');reply.tools.className='tool-trace';reply.toolLabels={};reply.el.insertBefore(reply.tools,reply.content);}
  let label=reply.toolLabels[event.name];if(!label){label=document.createElement('span');reply.tools.append(label);reply.toolLabels[event.name]=label;}
  label.dataset.status=event.status;label.textContent=(event.status==='running'?'◌ ':event.status==='complete'?'✓ ':'! ')+event.name.replace(/_/g,' ');if(event.error)label.title=event.error;return;
 }
 if(event.type==='references'){renderReferences(event.references,reply);return;}
 document.body.dataset.view='chat';$('#view-toggle').setAttribute('aria-pressed','false');
 if(event.type==='images')renderImages(event.images,reply);
 if(event.type==='map')renderMap(event.map,reply);
 if(event.type==='planner')renderPlanner(event.planner,reply,activeAccount||'local');
 if(event.type==='weather')renderWeather(event.forecast,reply);
 if(event.type==='information')renderInformation(event.info,reply);
 if(event.type==='result')renderResult(event,reply);
 if(!restoring)revealVisual(reply);
}
async function saveConversation(){
 if(!history.length||restoring||!workspaceUI)return;
 conversationId=conversationId||crypto.randomUUID();
 const savedId=conversationId,savedAccount=activeAccount;
 const chat={id:conversationId,title:transcript.find(t=>t.role==='user')?.text||'Conversation',history,turns:transcript};
 try{await workspaceUI.action({action:'saveChat',chat});if(conversationId===savedId&&activeAccount===savedAccount)localStorage.setItem('jarvis.activeChat.'+(savedAccount||'local'),savedId);$('#memory-status').title='Conversation saved on this Mac. Click to manage personal memory.';workspaceUI.refresh().catch(()=>{});}
 catch(e){notice('Conversation not saved: '+e.message+' Keep this tab open.');}
}
async function restoreConversation(chat){
 if(busy||recording)return;stopSpeech();disposePanels();$('#messages').replaceChildren();history=chat.history;conversationId=chat.id;transcript=chat.turns;restoring=true;
 try{for(const turn of transcript){const reply=message(turn.role,turn.text);reply.record=turn;if(turn.role==='assistant'){for(const event of turn.events||[])applyPanelEvent(event,reply);if(!reply.hasGallery)renderMessage(reply.content,turn.text);if(turn.text){const listen=document.createElement('button');listen.className='replay';listen.textContent='▷ Listen';listen.onclick=()=>{if(!busy&&!recording)speak(turn.text);};reply.el.append(listen);}}}}
 finally{restoring=false;updateControls();rest();}
 try{localStorage.setItem('jarvis.activeChat.'+(activeAccount||'local'),conversationId);}catch{}
 requestAnimationFrame(()=>{$('#messages').scrollTop=$('#messages').scrollHeight;});
}
