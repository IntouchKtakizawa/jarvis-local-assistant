import {randomBytes, randomUUID, createHash, timingSafeEqual} from 'node:crypto';
import {mkdir, readFile, writeFile, rename, chmod} from 'node:fs/promises';
import {join} from 'node:path';
import {createRemoteJWKSet, jwtVerify} from 'jose';

export const ISSUER='https://auth.openai.com';
export const RESOURCE='https://api.openai.com/v1';
export const PLAN_SCOPE='chatgpt.tokens.use.direct';
const SCOPES=`openid profile email offline_access resource.invoke ${PLAN_SCOPE}`;
const random=()=>randomBytes(32).toString('base64url');
export function equal(a,b){if(typeof a!=='string'||typeof b!=='string')return false;const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export class AuthError extends Error {constructor(message,code='authentication_required',status=401){super(message);this.code=code;this.status=status;}}
export async function verifyIdentity(token,clientId,nonce,keys){
  const {payload}=await jwtVerify(token,keys,{issuer:ISSUER,audience:clientId,algorithms:['RS256'],requiredClaims:['sub','exp','iat'],clockTolerance:5});
  if(nonce!==undefined&&!equal(payload.nonce,nonce))throw new AuthError('Sign-in token nonce did not match. Start sign-in again.');
  if(typeof payload.sub!=='string'||!payload.sub)throw new AuthError('Sign-in returned no verified identity.');
  return {subject:payload.sub,issuer:payload.iss,email:typeof payload.email==='string'?payload.email:null};
}
export class ChatGPTAuth {
  constructor({dir,origin,fetcher=fetch,verify=verifyIdentity,keys}={}){
    this.dir=dir;this.origin=origin;this.fetch=fetcher;this.verify=verify;this.keys=keys;
    this.pending=null;this.refreshing=null;this.revision=0;this.loggingOut=false;
    this.ready=this.load();
  }
  async load(){
    await mkdir(this.dir,{recursive:true,mode:0o700});await chmod(this.dir,0o700);
    try{this.data=JSON.parse(await readFile(join(this.dir,'accounts.json'),'utf8'));await chmod(join(this.dir,'accounts.json'),0o600);}
    catch(e){if(e.code!=='ENOENT')throw new Error('Cannot read protected sign-in storage.');this.data={version:1,hostId:`urn:uuid:${randomUUID()}`,active:null,accounts:[]};await this.save();}
  }
  async save(){this.saving=(this.saving||Promise.resolve()).then(async()=>{const tmp=join(this.dir,`accounts-${randomUUID()}.tmp`);await writeFile(tmp,JSON.stringify(this.data),{mode:0o600});await rename(tmp,join(this.dir,'accounts.json'));});return this.saving;}
  async metadata(){
    if(!this.discovery)this.discovery=(async()=>{const r=await this.fetch(`${ISSUER}/.well-known/openid-configuration`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw new AuthError('OpenAI sign-in discovery is unavailable. Try again later.','auth_unavailable',503);const d=await r.json();if(d.issuer!==ISSUER)throw new Error('Unexpected OpenAI issuer');for(const key of ['token_endpoint','revocation_endpoint','jwks_uri','authorization_endpoint']){if(new URL(d[key]).origin!==ISSUER)throw new Error('Unexpected OpenAI sign-in endpoint');}this.keys??=createRemoteJWKSet(new URL(d.jwks_uri));return d;})().catch(e=>{this.discovery=null;throw e;});
    return this.discovery;
  }
  active(){return this.data.accounts.find(a=>a.id===this.data.active);}
  async status(){await this.ready;const a=this.active();return {signedIn:Boolean(a?.access_token)&&!this.loggingOut,planEnabled:Boolean(a?.scopes?.includes(PLAN_SCOPE)),activeId:a?.id??null,accounts:this.data.accounts.map(a=>({id:a.id,label:a.label,email:a.email,signedIn:Boolean(a.access_token)})),pending:Boolean(this.pending&&this.pending.expires>Date.now()),welcomeRequired:Boolean(a?.access_token&&!a.welcomed),error:this.lastError??null};}
  async start(accountId,browserBinding){
    await this.ready;if(this.loggingOut||this.refreshing||this.pending?.exchanging)throw new AuthError('An account operation is already running.','auth_busy',409);
    const account=accountId?this.data.accounts.find(a=>a.id===accountId):null;if(accountId&&!account)throw new AuthError('Saved account was not found.','invalid_account',400);
    const d=await this.metadata();const verifier=random();
    const p={state:random(),nonce:random(),verifier,binding:browserBinding,expires:Date.now()+10*60*1000,redirect:`${this.origin}/auth/callback`,accountId:account?.id,clientId:account?.client_id};
    this.pending=p;this.lastError=null;
    const url=new URL(d.authorization_endpoint);const params={client_id:p.clientId||'dynamic_agent_client',ext_agent_host_id:this.data.hostId,response_type:'code',redirect_uri:p.redirect,scope:SCOPES,resource:RESOURCE,state:p.state,nonce:p.nonce,code_challenge_method:'S256',code_challenge:createHash('sha256').update(verifier).digest('base64url')};
    if(!account)params.agent_name_hint='JARVIS';
    else{if(account.id_token)params.id_token_hint=account.id_token;if(account.email)params.login_hint=account.email;if(!account.scopes?.includes(PLAN_SCOPE))params.prompt='consent';}
    for(const [key,value]of Object.entries(params))url.searchParams.set(key,value);
    return url.href;
  }
  async exchange(params){const d=await this.metadata();const response=await this.fetch(d.token_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(params),signal:AbortSignal.timeout(20000)});if(!response.ok){let code='oauth_exchange_failed';try{const data=await response.json();if(typeof data.error==='string')code=data.error;}catch{}throw new AuthError(`OpenAI sign-in could not renew or exchange credentials (${code}). Please sign in again.`,code,response.status);}return response.json();}
  tokenFields(tokens,previous){
    if(typeof tokens.access_token!=='string'||!tokens.access_token||tokens.token_type?.toLowerCase()!=='bearer'||!Number.isFinite(tokens.expires_in)||tokens.expires_in<=0)throw new AuthError('OpenAI returned an invalid credential response.');
    const scopes=typeof tokens.scope==='string'?tokens.scope.split(/\s+/).filter(Boolean):previous?.scopes;
    if(!scopes)throw new AuthError('OpenAI did not report the granted permissions.');
    return {access_token:tokens.access_token,refresh_token:tokens.refresh_token??previous?.refresh_token,id_token:tokens.id_token??previous?.id_token,scopes,expires_at:Date.now()+tokens.expires_in*1000};
  }
  async callback(params,binding){
    await this.ready;const p=this.pending;
    if(!p||p.exchanging||p.expires<Date.now()||!equal(params.get('state'),p.state)||!equal(binding,p.binding))throw new AuthError('Sign-in verification failed or expired. Start again from JARVIS.','invalid_oauth_state',400);
    p.exchanging=true;
    try{
      if(params.has('error'))throw new AuthError('ChatGPT sign-in was declined or could not be completed.','consent_declined',400);
      const clientId=params.get('client_id')||p.clientId;
      if(!clientId||clientId==='dynamic_agent_client'||clientId.length>300||(p.clientId&&p.clientId!==clientId))throw new AuthError('Sign-in did not return the expected application registration.');
      const code=params.get('code');if(!code||code.length>8192)throw new AuthError('Sign-in callback has no valid authorization code.');
      const tokens=await this.exchange({grant_type:'authorization_code',client_id:clientId,code,code_verifier:p.verifier,redirect_uri:p.redirect,resource:RESOURCE});
      if(typeof tokens.id_token!=='string')throw new AuthError('OpenAI did not return an identity token.');
      const identity=await this.verify(tokens.id_token,clientId,p.nonce,this.keys);
      const previous=this.data.accounts.find(a=>a.id===p.accountId);
      if(previous&&(previous.subject!==identity.subject||previous.issuer!==identity.issuer))throw new AuthError('This sign-in belongs to a different account. Add it as a separate account.');
      const fields=this.tokenFields(tokens);
      const id=previous?.id||randomUUID();const account={...previous,id,...identity,client_id:clientId,...fields,label:previous?.label||`Account ${this.data.accounts.length+1} · ${identity.email||'ChatGPT'}`};
      this.data.accounts=this.data.accounts.filter(a=>a.id!==id);this.data.accounts.push(account);this.data.active=id;this.revision++;await this.save();this.lastError=null;
      return fields.scopes.includes(PLAN_SCOPE);
    }catch(e){this.lastError=e instanceof AuthError?e.message:'OpenAI identity validation failed. Please start sign-in again.';throw new AuthError(this.lastError,e.code??'invalid_identity',400);}
    finally{this.pending=null;}
  }
  cancel(){if(this.pending?.exchanging)throw new AuthError('Sign-in is being verified. Please wait.','auth_busy',409);this.pending=null;this.lastError=null;}
  async select(id){await this.ready;if(this.refreshing||this.loggingOut||this.pending)throw new AuthError('Finish the current account operation first.','auth_busy',409);const a=this.data.accounts.find(a=>a.id===id);if(!a)throw new AuthError('Unknown saved account.','invalid_account',400);this.data.active=id;this.revision++;this.lastError=null;await this.save();}
  async welcome(){await this.ready;const a=this.active();if(a){a.welcomed=true;await this.save();}}
  async accessToken(force=false){
    await this.ready;const a=this.active();if(this.loggingOut||!a?.access_token)throw new AuthError('Continue with ChatGPT to connect your plan.');
    if(!a.scopes.includes(PLAN_SCOPE))throw new AuthError('ChatGPT plan usage was not enabled. Sign in again and grant plan usage.','plan_permission_required',403);
    if(!force&&a.expires_at>Date.now()+60000)return a.access_token;
    if(this.refreshing)return this.refreshing;
    const rev=this.revision;
    this.refreshing=(async()=>{
      if(!a.refresh_token)throw new AuthError('Your session expired. Continue with ChatGPT again.');
      try{const tokens=await this.exchange({grant_type:'refresh_token',client_id:a.client_id,refresh_token:a.refresh_token,resource:RESOURCE});
        if(this.revision!==rev)throw new AuthError('Account changed during token renewal. Please retry.');
        if(tokens.id_token){const identity=await this.verify(tokens.id_token,a.client_id,undefined,this.keys);if(identity.subject!==a.subject)throw new AuthError('Refreshed identity did not match the account.');}
        Object.assign(a,this.tokenFields(tokens,a));await this.save();
        if(!a.scopes.includes(PLAN_SCOPE))throw new AuthError('ChatGPT plan usage is no longer authorised.','plan_permission_required',403);
        return a.access_token;
      }catch(e){if(['invalid_grant','invalid_token'].includes(e.code)){delete a.access_token;delete a.refresh_token;delete a.id_token;await this.save();}throw e;}
    })().finally(()=>{this.refreshing=null;});return this.refreshing;
  }
  async logout(){
    await this.ready;if(this.pending?.exchanging)throw new AuthError('Sign-in is being verified. Please wait.','auth_busy',409);
    this.loggingOut=true;this.pending=null;
    // Wait for any in-flight rotating refresh before revoking its latest token.
    try{if(this.refreshing)await this.refreshing.catch(()=>{});this.revision++;const a=this.active();let revoked=!a?.refresh_token;
      if(a?.refresh_token){try{const d=await this.metadata();for(let attempt=0;attempt<2;attempt++){const r=await this.fetch(d.revocation_endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:a.refresh_token,token_type_hint:'refresh_token',client_id:a.client_id}),signal:AbortSignal.timeout(10000)});if(r.status===200){revoked=true;break;}if(r.status<500)break;if(attempt===0)await new Promise(r=>setTimeout(r,300));}}catch{}}
      if(a){delete a.access_token;delete a.refresh_token;delete a.id_token;delete a.expires_at;await this.save();}
      this.lastError=null;return {revoked,message:revoked?'Signed out of JARVIS.':'Signed out locally. Remote revocation was not confirmed; disconnect JARVIS in ChatGPT Settings.'};
    }finally{this.loggingOut=false;}
  }
}
