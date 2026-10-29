const $=s=>document.querySelector(s);
const micIcon=$('#mic').innerHTML;
const welcomeTemplate=$('#welcome').cloneNode(true);let visualContext=true,scrollFrame=null,followOutput=true;
const apiFetch=(url,options={})=>fetch(url,{...options,headers:{...options.headers,'X-Jarvis-Client':'1'}});
let authPolling=null,authWorking=false,activeAccount=null;
let history=[],status={},busy=false,controller,audio,audioURL,speechController,speechEpoch=0,recording=null,recordStarting=false;
const states={idle:['STANDING BY','A quiet kind of powerful.','Your assistant is ready.'],offline:['AWAITING CONNECTION','Your assistant, almost online.','Continue with ChatGPT to connect your plan.'],thinking:['PROCESSING','Connecting the dots.','Thinking with your connected intelligence.'],listening:['LISTENING','Go ahead. I’m listening.','Click the microphone again to finish.'],transcribing:['TRANSCRIBING','Turning voice into thought.','Processing your recording with whisper.cpp.'],speaking:['SPEAKING','A thought, out loud.','Your local assistant is speaking.']};
function state(name){document.body.dataset.state=name;$('#talk-label').textContent=name==='listening'?'Finish recording':name==='transcribing'?'Transcribing…':name==='thinking'?'Thinking…':'Talk to JARVIS';$('#voice-stop').hidden=name!=='speaking';const s=states[name];$('#state').textContent=s[0];$('#state-title').textContent=s[1];$('#state-detail').textContent=s[2];}
function rest(){state(status.connected?'idle':'offline');}
function notice(text=''){$('#notice').textContent=text;}
function log(text){const li=document.createElement('li');li.textContent=text;const t=document.createElement('time');t.textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});li.append(t);$('#activity').prepend(li);while($('#activity').children.length>12)$('#activity').lastChild.remove();}
function clock(){$('#clock').textContent=new Date().toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',hour12:false})+' / LOCAL';}clock();setInterval(clock,1000);
for(let i=0;i<39;i++){const bar=document.createElement('i');bar.style.setProperty('--h',`${5+Math.sin(i*.7)**2*20}px`);bar.style.setProperty('--delay',`${i%7*.1}s`);$('.wave').append(bar);}
async function refresh({quiet=false}={}){
  $('#refresh').disabled=true;
  try{const response=await apiFetch('/api/status');if(!response.ok)throw new Error('App connection unavailable');const next=await response.json();
    if(activeAccount&&activeAccount!==next.auth.activeId){history=[];$('#messages').replaceChildren();message('assistant','Account changed. A fresh conversation is ready.');}
    activeAccount=next.auth.activeId;status=next;document.body.dataset.connected=String(status.connected);
    const selectedAccount=$('#account').value;const current=$('#model').value;$('#model').replaceChildren();
    for(const model of status.models){const option=document.createElement('option');option.value=model.id;option.textContent=model.name;$('#model').append(option);}
    if(!status.models.length){const option=document.createElement('option');option.textContent='Connect to load models';option.value='';$('#model').append(option);}
    $('#model').value=status.models.some(m=>m.id===current)?current:status.models.some(m=>m.id===status.defaultModel)?status.defaultModel:$('#model').options[0].value;
    const cloud=status.provider==='chatgpt',auth=status.auth;
    $('.privacy').textContent=cloud?'YOUR ACCOUNT · LOCAL VOICE':'LOCAL AI · LOCAL VOICE';$('#model-short').textContent=$('#model').value||'Connect a model';$('.core-bottom span').textContent=cloud?'CHATGPT INFERENCE':'ON-DEVICE PROCESSING';$('.local-note p').textContent=cloud?'Chat uses your ChatGPT plan with OpenAI. Speech recognition and voice synthesis run on this Mac.':'Chat and speech run on your machine using Ollama, whisper.cpp, and local TTS.';$('#connect-banner').hidden=!cloud||(auth.signedIn&&auth.planEnabled);$('#connect').textContent=auth.pending?'Waiting for sign-in…':'Continue with ChatGPT';$('#account-card').hidden=!cloud;$('#intelligence-label').textContent=cloud?'ChatGPT intelligence':'Local intelligence';
    $('#ollama-state').textContent=cloud?(status.connected?'Connected · ChatGPT plan':auth.signedIn?(auth.planEnabled?'Signed in · models unavailable':'Plan permission required'):'Not signed in'):status.connected?'Ollama · on this device':'Ollama offline';
    $('#auth-summary').textContent=auth.pending?'Waiting for ChatGPT sign-in…':auth.signedIn?(auth.planEnabled?'Your ChatGPT plan is connected.':'Signed in. Enable plan usage to chat.'):'Use your ChatGPT plan. No API key needed.';
    $('#account').replaceChildren();
    for(const account of auth.accounts){const option=document.createElement('option');option.value=account.id;option.textContent=account.label;$('#account').append(option);}
    const add=document.createElement('option');add.value='new';add.textContent='Add another ChatGPT account';$('#account').append(add);$('#account').value=selectedAccount==='new'?'new':auth.activeId||'new';
    $('#sign-in').textContent=auth.signedIn&&auth.planEnabled?'Sign in again with ChatGPT':'Continue with ChatGPT';
    $('#sign-out').hidden=!auth.signedIn;$('#cancel-login').hidden=!auth.pending;$('#plan-indicator').hidden=!cloud||!auth.signedIn||!auth.planEnabled;
    if(auth.pending&&!$('#settings').open)$('#settings').showModal();if(!auth.pending){$('#sign-in-link').hidden=true;clearInterval(authPolling);authPolling=null;}
    if(auth.welcomeRequired&&auth.planEnabled&&!$('#plan-welcome').open){$('#settings').close();$('#plan-welcome').showModal();}
    $('#stt-state').textContent=status.stt?'whisper.cpp · ready':'Not running · see setup guide';
    $('#tts-state').textContent=status.tts?(status.ttsProvider==='macos'?'macOS · British English':'Piper · local voice'):'Not configured';
    for(const[id,ok]of [['ollama',status.connected],['stt',status.stt],['tts',status.tts]])$(`#${id}-dot`).classList.toggle('ok',Boolean(ok));
    $('#test-voice').disabled=!status.tts;$('#auto-speak').disabled=!status.tts;updateControls();if(!busy&&!recording&&!speechController)rest();
    if(!quiet)log(status.connected?'Intelligence connection checked':'Waiting for intelligence connection');
    if(status.error)notice(status.error.message);else if(auth.error)notice(auth.error);else if(auth.pending)notice('Complete sign-in in the OpenAI window, or cancel to return.');else if(cloud&&!auth.signedIn)notice();else if(cloud&&!auth.planEnabled)notice('Sign in again and enable ChatGPT plan usage.');else if(!quiet)notice();
  }catch(e){notice(e.message);if(!quiet)log('Connection check failed');}finally{$('#refresh').disabled=false;}
}
function updateControls(){
  $('#send').disabled=busy||!!recording||recordStarting||authWorking||status.auth?.pending||!status.connected;$('#model').disabled=busy||!status.connected;
  $('#clear').disabled=busy||!!recording;$('#mic').disabled=(busy&&!recording)||recordStarting;$('#stop').hidden=!busy;$('#send').hidden=busy;
  for(const id of ['connect','sign-in','sign-out','account'])$('#'+id).disabled=busy||!!recording||authWorking||Boolean(status.auth?.pending);
  $('#cancel-login').disabled=authWorking;$('#talk').disabled=$('#mic').disabled;$('#visual-context').disabled=busy;
}
async function authAction(path,data={}){const response=await apiFetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error);return result;}
$('#sign-in').addEventListener('click',async()=>{
  stopSpeech();authWorking=true;updateControls();let popup=window.open('about:blank','jarvis-chatgpt-login');
  try{const accountId=$('#account').value;const result=await authAction('/api/auth/start',{accountId:accountId==='new'?null:accountId});const url=new URL(result.authUrl);if(url.origin!=='https://auth.openai.com')throw new Error('Unexpected sign-in destination.');
    const link=$('#sign-in-link');link.href=url.href;link.hidden=false;if(popup){popup.opener=null;popup.location.replace(url.href);}notice('Complete sign-in in the OpenAI window. Use the sign-in link if the window did not open.');log('Official ChatGPT sign-in started');
    authPolling=setInterval(()=>refresh({quiet:true}),4000);
  }catch(e){popup?.close();notice(e.message);}finally{authWorking=false;await refresh({quiet:true});}
});
$('#connect').addEventListener('click',()=>$('#sign-in').click());
$('#settings-open').addEventListener('click',()=>$('#settings').showModal());
$('#model-short').addEventListener('click',()=>$('#settings').showModal());
$('#view-toggle').addEventListener('click',()=>{const voice=document.body.dataset.view!=='voice';document.body.dataset.view=voice?'voice':'chat';$('#view-toggle').setAttribute('aria-pressed',String(voice));$('#view-toggle').setAttribute('aria-label',voice?'Switch to chat view':'Switch to voice view');});
$('#visual-context').addEventListener('click',()=>{visualContext=!visualContext;$('#visual-context').setAttribute('aria-pressed',String(visualContext));notice(visualContext?'Visual context on: relevant public topics may be looked up on Wikipedia.':'Visual context off. No automatic reference lookups.');});
$('#context-about').addEventListener('click',()=>{$('#settings').showModal();$('#context-info').open=true;$('#context-info').scrollIntoView({block:'center',behavior:'smooth'});});
$('#messages').addEventListener('scroll',()=>{const m=$('#messages');followOutput=m.scrollHeight-m.scrollTop-m.clientHeight<100;},{passive:true});
$('#settings-close').addEventListener('click',()=>$('#settings').close());
$('#talk').addEventListener('click',()=>$('#mic').click());
$('#voice-stop').addEventListener('click',()=>{stopSpeech();rest();});
$('#cancel-login').addEventListener('click',async()=>{try{await authAction('/api/auth/cancel');notice('Sign-in cancelled.');await refresh({quiet:true});}catch(e){notice(e.message);}});
$('#sign-out').addEventListener('click',async()=>{authWorking=true;updateControls();stopSpeech();try{const result=await authAction('/api/auth/logout');history=[];$('#messages').replaceChildren();message('assistant','Signed out. Your next session will start fresh.');await refresh({quiet:true});notice(result.message);log('ChatGPT signed out');}catch(e){notice(e.message);}finally{authWorking=false;updateControls();}});
$('#account').addEventListener('change',async()=>{if($('#account').value==='new'){notice('Click Continue with ChatGPT to add this account.');return;}authWorking=true;updateControls();stopSpeech();try{await authAction('/api/auth/select',{id:$('#account').value});await refresh({quiet:true});}catch(e){notice(e.message);}finally{authWorking=false;updateControls();}});
$('#welcome-dismiss').addEventListener('click',async()=>{try{await authAction('/api/auth/welcome');$('#plan-welcome').close();}catch(e){notice(e.message);}});
function message(role,text){document.body.dataset.conversation='true';$('#welcome')?.remove();followOutput=true;const el=document.createElement('article');el.className=`message ${role}`;const label=document.createElement('div');label.className='message-label';label.textContent=role==='user'?'YOU':'✳  JARVIS';const content=document.createElement('div');content.className='message-content';content.textContent=text;el.append(label,content);$('#messages').append(el);scroll();return {el,content};}
function scroll(){if(scrollFrame)return;scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;$('#message-count').textContent=$('#messages').querySelectorAll('.message').length;if(followOutput)$('#messages').scrollTop=$('#messages').scrollHeight;});}
function sourceURL(value,hosts){try{const u=new URL(value);return u.protocol==='https:'&&hosts.includes(u.hostname)&&!u.username&&!u.password?u.href:null;}catch{return null;}}
function link(text,url){const a=document.createElement('a');a.textContent=text;a.href=url;a.target='_blank';a.rel='noopener noreferrer';return a;}
function renderReferences(references,reply){
 const tray=document.createElement('div');tray.className='reference-tray';let count=0;
 for(const reference of references.slice(0,2)){
  const url=sourceURL(reference.url,['en.wikipedia.org']);if(!url)continue;count++;
  const card=document.createElement('article');card.className='reference-card';
  const image=reference.image,src=sourceURL(image?.url,['upload.wikimedia.org','thumb.wikimedia.org']),credit=sourceURL(image?.creditURL,['commons.wikimedia.org']);
  if(src&&credit&&image.license){const img=document.createElement('img');img.src=src;img.alt=image.alt||reference.title;img.loading='lazy';img.decoding='async';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>img.remove(),{once:true});card.append(img);}
  const copy=document.createElement('div');copy.className='reference-copy';const label=document.createElement('div');label.className='source-label';label.textContent=`[${count}] WIKIPEDIA`;const title=document.createElement('h3');title.textContent=reference.title;const extract=document.createElement('p');extract.textContent=reference.extract.slice(0,220)+(reference.extract.length>220?'…':'');copy.append(label,title,extract,link('Read source ↗',url));card.append(copy);
  if(src&&credit&&image.license){const attribution=document.createElement('div');attribution.className='image-credit';const artist=document.createElement('span');artist.textContent=image.artist;attribution.append(artist,link(`Image · ${image.license} ↗`,credit));card.append(attribution);}
  tray.append(card);
 }
 if(count)reply.el.insertBefore(tray,reply.content);scroll();
}
async function discoverTopic(topic){
 if(busy||recording||recordStarting)return;stopSpeech();busy=true;controller=new AbortController();updateControls();document.body.dataset.view='chat';$('#view-toggle').setAttribute('aria-pressed','false');message('user',`Show me ${topic}`);const reply=message('assistant','Finding references…');reply.content.classList.add('lookup-loader');reply.el.querySelector('.message-label').textContent='REFERENCE LOOKUP';state('thinking');notice();
 try{const r=await apiFetch('/api/discover',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({query:topic}),signal:controller.signal});const data=await r.json();if(!r.ok)throw new Error(data.error);reply.content.classList.remove('lookup-loader');reply.content.textContent=data.references.length?'Reference material from Wikipedia. Images, when available, link to their creator and licence.':'No useful references found. Try a more specific public topic.';renderReferences(data.references,reply);log(`References loaded for ${data.query}`);}
 catch(e){reply.content.classList.remove('lookup-loader');reply.content.textContent=e.name==='AbortError'?'Lookup stopped.':`Reference lookup unavailable: ${e.message}`;}
 finally{busy=false;controller=null;updateControls();rest();scroll();}
}
function stopSpeech(){$('#test-voice').textContent='Preview assistant voice ▷';$('#voice-stop').hidden=true;speechEpoch++;speechController?.abort();speechController=null;if(audio){audio.pause();audio=null;}if(audioURL){URL.revokeObjectURL(audioURL);audioURL=null;}}
async function speak(text){stopSpeech();const epoch=speechEpoch; speechController=new AbortController();$('#test-voice').textContent='Stop voice ■';state('speaking');log('Synthesising local speech');try{const response=await apiFetch('/api/speak',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({text:text.slice(0,5000)}),signal:speechController.signal});if(!response.ok)throw new Error((await response.json()).error);const blob=await response.blob();if(epoch!==speechEpoch)return;audioURL=URL.createObjectURL(blob);audio=new Audio(audioURL);audio.onended=()=>{stopSpeech();rest();};await audio.play();log('Playing assistant voice');}catch(e){if(epoch!==speechEpoch)return;notice(e.name==='NotAllowedError'?'Click a reply’s “Listen” button to allow audio playback.':e.message);stopSpeech();rest();}}
async function send(){const text=$('#prompt').value.trim();if(!text||busy||recording||authWorking||status.auth?.pending)return;if(!status.connected){notice('Connect your intelligence account and select a model before sending.');return;}
  if(history.length>=78){notice('Conversation is full. Start a new conversation to continue.');return;}
  stopSpeech();notice();busy=true;updateControls();$('#prompt').value='';history.push({role:'user',content:text});message('user',text);const reply=message('assistant','');controller=new AbortController();let output='',complete=false;state('thinking');log(`Prompt sent to ${$('#model').value}`);
  try{const response=await apiFetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,model:$('#model').value,visualContext}),signal:controller.signal});if(!response.ok)throw new Error((await response.json()).error);const reader=response.body.getReader(),decoder=new TextDecoder();let pending='';
    while(true){const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});let i;while((i=pending.indexOf('\n'))>=0){const line=pending.slice(0,i);pending=pending.slice(i+1);if(!line.trim())continue;const event=JSON.parse(line);if(event.type==='error')throw new Error(event.error);if(event.type==='references'){reply.content.textContent='';renderReferences(event.references,reply);log(`Visual context: ${event.query}`);}if(event.type==='activity'){log(event.text);}if(event.type==='token'){output+=event.content;if(!reply.frame)reply.frame=requestAnimationFrame(()=>{reply.frame=null;reply.content.textContent=output;scroll();});}if(event.type==='done')complete=true;}}
    if(!complete)throw new Error('Response was interrupted. Please retry.');if(!output.trim())throw new Error('The model returned no text. Try another prompt or model.');
    if(reply.frame)cancelAnimationFrame(reply.frame);reply.frame=null;reply.content.textContent=output;history.push({role:'assistant',content:output});log('Response complete');const listen=document.createElement('button');listen.className='replay';listen.textContent='▷ Listen';listen.addEventListener('click',()=>{if(!busy&&!recording)speak(output);});reply.el.append(listen);
  }catch(e){if(reply.frame)cancelAnimationFrame(reply.frame);reply.frame=null;complete=false;history.pop();reply.el.classList.add('failed');reply.content.textContent=(output?output+'\n\n':'')+(e.name==='AbortError'?'Response stopped.':e.message);log(e.name==='AbortError'?'Response stopped':'Response failed');notice('Your prompt is back in the composer so you can retry.');$('#prompt').value=text;}
  finally{busy=false;controller=null;updateControls();rest();$('#prompt').focus();}
  if(complete&&output&&$('#auto-speak').checked)await speak(output);
}
$('#chat-form').addEventListener('submit',e=>{e.preventDefault();send();});$('#prompt').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
$('#stop').addEventListener('click',()=>controller?.abort());$('#refresh').addEventListener('click',()=>refresh());
$('#clear').addEventListener('click',()=>{stopSpeech();history=[];$('#messages').replaceChildren();document.body.dataset.conversation='false';$('#hero-welcome').replaceChildren(welcomeTemplate.cloneNode(true));$('#prompt').value='';notice();rest();log('New conversation started');scroll();});
document.addEventListener('click',e=>{const topic=e.target.closest('[data-topic]');if(topic){discoverTopic(topic.dataset.topic);return;}const button=e.target.closest('[data-prompt]');if(button){$('#prompt').value=button.dataset.prompt;$('#prompt').focus();}});
$('#test-voice').addEventListener('click',()=>{if(speechController){stopSpeech();rest();return;}if(!busy&&!recording)speak('Hello. Your assistant is ready. What shall we work on?');});
$('#auto-speak').addEventListener('change',()=>{if(!$('#auto-speak').checked){stopSpeech();if(!busy&&!recording)rest();}});
// Capture PCM directly: no cloud speech recognition, codecs, or ffmpeg required.
function wav(samples,rate){const length=Math.floor(samples.length*16000/rate);const buffer=new ArrayBuffer(44+length*2),v=new DataView(buffer);const str=(at,s)=>[...s].forEach((c,i)=>v.setUint8(at+i,c.charCodeAt(0)));str(0,'RIFF');v.setUint32(4,36+length*2,true);str(8,'WAVE');str(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);str(36,'data');v.setUint32(40,length*2,true);
  for(let i=0;i<length;i++){const start=Math.floor(i*rate/16000),end=Math.max(start+1,Math.floor((i+1)*rate/16000));let sum=0;for(let j=start;j<Math.min(end,samples.length);j++)sum+=samples[j];const x=Math.max(-1,Math.min(1,sum/(end-start)));v.setInt16(44+i*2,x<0?x*32768:x*32767,true);}return buffer;}
async function finishRecording(){const r=recording;if(!r)return;recording=null;clearTimeout(r.timer);r.processor.disconnect();r.source.disconnect();r.mute.disconnect();r.stream.getTracks().forEach(t=>t.stop());await r.ctx.close();$('#mic').innerHTML=micIcon;$('#mic').setAttribute('aria-label','Start recording');$('#mic').setAttribute('aria-pressed','false');busy=true;controller=new AbortController();updateControls();state('transcribing');
  try{const samples=new Float32Array(r.chunks.reduce((n,c)=>n+c.length,0));let offset=0;for(const c of r.chunks){samples.set(c,offset);offset+=c.length;}if(samples.length<r.rate*.25)throw new Error('Recording was too short. Please try again.');const response=await apiFetch('/api/transcribe',{method:'POST',headers:{'Content-Type':'audio/wav'},body:wav(samples,r.rate),signal:controller.signal});const data=await response.json();if(!response.ok)throw new Error(data.error);$('#prompt').value=data.text;notice(data.text?'Transcript ready. Review it, then press Send.':'No speech detected. Please try again.');log('Local transcription complete');$('#prompt').focus();}catch(e){notice(e.name==='AbortError'?'Transcription stopped.':`Speech recognition: ${e.message}`);log('Transcription ended');}finally{controller=null;busy=false;updateControls();rest();}}
$('#mic').addEventListener('click',async()=>{if(recording)return finishRecording();if(busy||recordStarting)return;if(!status.stt){notice('Microphone recognition is offline. Start whisper-server, then refresh connections in Settings.');$('#settings').showModal();return;}stopSpeech();recordStarting=true;updateControls();let stream,ctx;try{stream=await navigator.mediaDevices.getUserMedia({audio:{channelCount:1,echoCancellation:true,noiseSuppression:true}});ctx=new AudioContext();await ctx.resume();const source=ctx.createMediaStreamSource(stream),processor=ctx.createScriptProcessor(4096,1,1),mute=ctx.createGain();mute.gain.value=0;const r={stream,ctx,source,processor,mute,chunks:[],rate:ctx.sampleRate};recording=r;processor.onaudioprocess=e=>{if(recording!==r)return;const samples=new Float32Array(e.inputBuffer.getChannelData(0));r.chunks.push(samples);let power=0;for(const s of samples)power+=s*s;document.body.style.setProperty('--level',Math.min(1,Math.sqrt(power/samples.length)*8));};source.connect(processor);processor.connect(mute);mute.connect(ctx.destination);r.timer=setTimeout(finishRecording,45000);$('#mic').textContent='■';$('#mic').setAttribute('aria-label','Finish recording');$('#mic').setAttribute('aria-pressed','true');notice('Recording locally · maximum 45 seconds. Click ■ to finish.');state('listening');log('Microphone opened · local capture');}catch(e){stream?.getTracks().forEach(t=>t.stop());if(ctx)await ctx.close();notice(`Microphone: ${e.message}`);rest();}finally{recordStarting=false;updateControls();}});
window.addEventListener('keydown',e=>{if(e.key==='Escape'){controller?.abort();stopSpeech();if(!busy&&!recording)rest();}});
window.addEventListener('pagehide',()=>{clearInterval(authPolling);stopSpeech();recording?.stream.getTracks().forEach(t=>t.stop());recording?.ctx.close();controller?.abort();});
if(new URLSearchParams(location.search).has('signin')){window.history.replaceState(null,'','/');}
log('Workspace initialised');refresh();
