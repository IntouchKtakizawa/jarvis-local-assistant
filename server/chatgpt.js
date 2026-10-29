import {SYSTEM} from './ollama.js';
import {RESOURCE,AuthError} from './auth.js';
const recovery={
  subscription_sharing_usage_limit_exceeded:'Your ChatGPT plan or app usage limit was reached. Open Manage usage to review it.',
  subscription_sharing_user_not_eligible:'ChatGPT plan usage is unavailable for this account or workspace.',
  subscription_sharing_usage_unavailable:'ChatGPT usage availability could not be checked. Please try again later.',
  subscription_sharing_user_unavailable:'Your ChatGPT account is temporarily unavailable. Please try again later.',
  subscription_sharing_unsupported_capability:'This model or capability is unavailable through ChatGPT plan usage. Try another model.',
  subscription_sharing_route_not_supported:'OpenAI did not accept the ChatGPT plan inference route.',
  subscription_sharing_invalid_user:'OpenAI could not validate your subscriber session. Sign in again.',
};
export function upstreamError(data,status=502,requestId=null){
  const code=data?.error?.code||data?.code||'openai_request_failed';
  const detail=data?.error?.message||data?.detail||data?.message;
  const fallback=status===401?'Your ChatGPT session was not accepted. Sign in again.':status===403?'OpenAI denied access for this account, workspace, or serving region.':status===503?'ChatGPT plan routing is temporarily unavailable. Please retry later.':`OpenAI request failed (${status}).`;
  const e=new Error(recovery[code]|| (typeof detail==='string'?detail.slice(0,500):fallback));e.code=code;e.status=status;e.requestId=requestId;return e;
}
// SSE can split at any byte, including UTF-8 sequences and CRLF delimiters.
export async function* events(body){
  const decoder=new TextDecoder();let pending='',data=[];
  for await(const chunk of body){pending+=decoder.decode(chunk,{stream:true});let end;
    while((end=pending.indexOf('\n'))>=0){let line=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);if(line===''){if(data.length){const text=data.join('\n');data=[];if(text!=='[DONE]')yield JSON.parse(text);}}else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
  }
  // A terminal SSE event requires its blank-line delimiter.
}
export class ChatGPTProvider{
  constructor(auth,{fetcher=fetch}={}){this.auth=auth;this.fetch=fetcher;}
  async request(path,options={}){
    let token=await this.auth.accessToken();
    const send=()=>this.fetch(`${RESOURCE}${path}`,{...options,headers:{...options.headers,Authorization:`Bearer ${token}`},signal:options.signal||AbortSignal.timeout(20000)});
    let response=await send();if(response.status===401){await response.body?.cancel();token=await this.auth.accessToken(true);response=await send();}
    if(!response.ok){let data;try{data=await response.json();}catch{data={};}throw upstreamError(data,response.status,response.headers.get('x-request-id'));}return response;
  }
  async models(){const response=await this.request('/models');const data=await response.json();if(!Array.isArray(data.models))throw new Error('OpenAI returned an unexpected ChatGPT model catalog.');return data.models.filter(m=>m.visibility==='list'&&typeof m.slug==='string').map(m=>({id:m.slug,name:m.display_name||m.slug}));}
  async *chat(messages,model,signal){
    if(!model)throw new AuthError('Choose a model available to your ChatGPT account.','model_required',400);
    const response=await this.request('/responses',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model,instructions:SYSTEM.replace('personal local assistant','personal assistant'),input:messages.map(m=>({role:m.role,content:m.content})),store:false,stream:true}),signal});
    let complete=false;
    for await(const event of events(response.body)){
      if(event.type==='response.output_text.delta'&&typeof event.delta==='string')yield{type:'token',content:event.delta};
      if(event.type==='response.completed'){complete=true;yield{type:'done',tokens:event.response?.usage?.output_tokens??null};}
      if(event.type==='response.failed')throw upstreamError(event.response,502,response.headers.get('x-request-id'));
      if(event.type==='response.incomplete')throw new Error('OpenAI returned an incomplete reply. Please retry or choose another model.');
      if(event.type==='error')throw upstreamError(event,502,response.headers.get('x-request-id'));
    }
    if(!complete)throw new Error('OpenAI stream ended before completion. Please retry.');
  }
}
