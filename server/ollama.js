import {referenceInput} from './references.js';
import {CORE_PROMPT} from './prompt.js';
export const SYSTEM = CORE_PROMPT;
export class OllamaProvider {
  constructor(url, model) { this.url = url; this.model = model; }
  async models() {
    const response = await fetch(`${this.url}/api/tags`, {signal: AbortSignal.timeout(2500)});
    if (!response.ok) throw new Error('Ollama model list unavailable');
    return (await response.json()).models.map(m => m.name);
  }
  async agentTurn(input,model,tools,signal,instructions){
    const messages=[{role:'system',content:instructions}];
    for(const item of input){
      if(item.role)messages.push({role:item.role,content:item.content});
      else if(item.type==='function_call')messages.push({role:'assistant',content:'',tool_calls:[{function:{name:item.name,arguments:JSON.parse(item.arguments)}}]});
      else if(item.type==='function_call_output')messages.push({role:'tool',tool_name:input.find(i=>i.call_id===item.call_id)?.name,content:item.output});
    }
    const r=await fetch(`${this.url}/api/chat`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model:model||this.model,messages,tools:tools.map(({name,description,parameters})=>({type:'function',function:{name,description,parameters}})),stream:false}),signal});
    if(!r.ok)throw new Error(`Ollama tool request failed (${r.status}). Choose a model with tool support.`);
    const data=await r.json();if(data.error)throw new Error(data.error);const calls=(data.message?.tool_calls||[]).map((t,i)=>({type:'function_call',name:t.function.name,arguments:JSON.stringify(t.function.arguments),call_id:'local_'+Date.now()+'_'+i}));
    const output=[...calls];if(data.message?.content)output.push({role:'assistant',content:data.message.content});return {text:data.message?.content||'',calls,output};
  }
  async *chat(messages, model, signal, references=[]) {
    const response = await fetch(`${this.url}/api/chat`, {method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({model:model || this.model, messages:[{role:'system',content:SYSTEM},...referenceInput(messages,references)],stream:true}), signal});
    if (!response.ok) throw new Error(`Ollama ${response.status}: ${(await response.text()).slice(0,400)}`);
    const decoder = new TextDecoder(); let pending = ''; let done = false;
    const parse = line => { const item = JSON.parse(line); if(item.error) throw new Error(item.error); return item; };
    for await (const chunk of response.body) {
      pending += decoder.decode(chunk,{stream:true});
      let end;
      while((end = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0,end).trim(); pending = pending.slice(end+1);
        if(!line) continue;
        const item = parse(line);
        if(item.message?.content) yield {type:'token',content:item.message.content};
        if(item.done) { done=true; yield {type:'done',tokens:item.eval_count ?? null}; }
      }
    }
    pending += decoder.decode();
    if(pending.trim()) { const item = parse(pending); if(item.message?.content) yield {type:'token',content:item.message.content}; if(item.done) {done=true; yield {type:'done',tokens:item.eval_count??null};} }
    if(!done) throw new Error('Ollama stream ended before completion. Please retry.');
  }
}
