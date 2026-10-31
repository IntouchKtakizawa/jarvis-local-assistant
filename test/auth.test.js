import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,stat,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK} from 'jose';
import {ChatGPTAuth,ISSUER,RESOURCE,PLAN_SCOPE,verifyIdentity,equal} from '../server/auth.js';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const jwk=await exportJWK(publicKey);jwk.kid='test';const keys=createLocalJWKSet({keys:[jwk]});
async function token(nonce,client='issued-client',subject='user-1',extra={}){return new SignJWT({nonce,email:'user@example.test',...extra}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(ISSUER).setAudience(client).setSubject(subject).setIssuedAt().setExpirationTime('1h').sign(privateKey);}
async function fixture(fn,options={}){
 const dir=await mkdtemp(join(tmpdir(),'jarvis-auth-test-'));let grants=[],revokeCount=0,auth;
 const fetcher=async(url,request={})=>{
  if(url.endsWith('openid-configuration'))return Response.json({issuer:ISSUER,authorization_endpoint:ISSUER+'/api/accounts/authorize',token_endpoint:ISSUER+'/api/accounts/oauth/token',revocation_endpoint:ISSUER+'/api/accounts/oauth/revoke',jwks_uri:ISSUER+'/.well-known/jwks.json'});
  const form=new URLSearchParams(request.body);grants.push(form);
  if(url.endsWith('/revoke')){revokeCount++;return new Response(null,{status:options.revokeStatus||200});}
  if(form.get('grant_type')==='refresh_token'){await new Promise(r=>setTimeout(r,10));return Response.json({access_token:'refreshed-access',refresh_token:'rotated-refresh',token_type:'Bearer',expires_in:3600,scope:PLAN_SCOPE});}
  return Response.json({access_token:'fake-access',refresh_token:'fake-refresh',id_token:await token(auth.pending.nonce,form.get('client_id'),options.subject||'user-1'),token_type:'Bearer',expires_in:3600,scope:options.scope??`openid email ${PLAN_SCOPE}`});
 };
 auth=new ChatGPTAuth({dir,origin:'http://127.0.0.1:3210',fetcher,keys});await auth.ready;
 try{await fn({auth,dir,grants,getRevokes:()=>revokeCount});}finally{await rm(dir,{recursive:true,force:true});}
}
async function login(auth,accountId){const url=new URL(await auth.start(accountId,'browser-binding'));const params=new URLSearchParams({state:url.searchParams.get('state'),code:'fake-code',client_id:auth.pending.clientId||'issued-client'});return auth.callback(params,'browser-binding');}
test('dynamic registration uses PKCE and stable host; exchanges issued client ID; never leaks credentials',async()=>fixture(async({auth,dir,grants})=>{
 const url=new URL(await auth.start(null,'browser-binding'));assert.equal(url.origin,ISSUER);assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('agent_name_hint'),'Kenta JARVIS');assert.equal(url.searchParams.get('resource'),RESOURCE);assert.equal(url.searchParams.get('code_challenge_method'),'S256');assert.ok(url.searchParams.get('code_challenge'));const host=url.searchParams.get('ext_agent_host_id');
 await auth.callback(new URLSearchParams({state:auth.pending.state,code:'fake',client_id:'issued-client'}),'browser-binding');assert.equal(grants[0].get('client_id'),'issued-client');assert.equal(grants[0].get('redirect_uri'),'http://127.0.0.1:3210/auth/callback');
 const status=await auth.status();assert.equal(status.signedIn,true);assert.equal(status.planEnabled,true);assert.equal(status.welcomeRequired,true);assert.ok(!JSON.stringify(status).includes('fake-access'));assert.ok(!JSON.stringify(status).includes('fake-refresh'));assert.ok(!JSON.stringify(status).includes('id_token'));
 assert.equal((await stat(join(dir,'accounts.json'))).mode&0o777,0o600);assert.equal((await stat(dir)).mode&0o777,0o700);
 await auth.welcome();assert.equal((await auth.status()).welcomeRequired,false);
 const next=new URL(await auth.start(status.activeId,'browser-binding'));assert.equal(next.searchParams.get('client_id'),'issued-client');assert.equal(next.searchParams.get('ext_agent_host_id'),host);assert.equal(next.searchParams.get('agent_name_hint'),null);
}));
test('rejects wrong state, browser binding, and replayed callbacks before token exchange',async()=>fixture(async({auth,grants})=>{
 await auth.start(null,'browser-binding');const state=auth.pending.state;await assert.rejects(auth.callback(new URLSearchParams({state:'wrong',code:'x'}),'browser-binding'),/verification failed/);await assert.rejects(auth.callback(new URLSearchParams({state,code:'x'}),'another-browser'),/verification failed/);assert.equal(grants.length,0);
 await auth.callback(new URLSearchParams({state,code:'x',client_id:'issued-client'}),'browser-binding');await assert.rejects(auth.callback(new URLSearchParams({state,code:'x',client_id:'issued-client'}),'browser-binding'),/verification failed/);
}));
test('declined consent stops exchange; missing plan scope permits identity but blocks inference',async()=>{
 await fixture(async({auth,grants})=>{await auth.start(null,'browser-binding');await assert.rejects(auth.callback(new URLSearchParams({state:auth.pending.state,error:'access_denied'}),'browser-binding'),/declined/);assert.equal(grants.length,0);});
 await fixture(async({auth})=>{assert.equal(await login(auth),false);assert.equal((await auth.status()).signedIn,true);await assert.rejects(auth.accessToken(),/not enabled/);},{scope:'openid email'});
});
test('ID-token validation rejects wrong nonce, issuer, audience and expired tokens',async()=>{
 await assert.rejects(verifyIdentity(await token('one'),'issued-client','two',keys),/nonce/);
 await assert.rejects(verifyIdentity(await token('one','other-client'),'issued-client','one',keys));
 const expired=await new SignJWT({nonce:'one'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer(ISSUER).setAudience('issued-client').setSubject('u').setIssuedAt().setExpirationTime(1).sign(privateKey);
 await assert.rejects(verifyIdentity(expired,'issued-client','one',keys));
 const foreign=await new SignJWT({nonce:'one'}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://example.test').setAudience('issued-client').setSubject('u').setIssuedAt().setExpirationTime('1h').sign(privateKey);
 await assert.rejects(verifyIdentity(foreign,'issued-client','one',keys));assert.equal(equal('é','a'),false);
});
test('returning registration rejects client substitution without replacing active account',async()=>fixture(async({auth})=>{
 await login(auth);const before=await auth.status();await auth.start(before.activeId,'browser-binding');await assert.rejects(auth.callback(new URLSearchParams({state:auth.pending.state,code:'fake',client_id:'substituted'}),'browser-binding'),/expected application registration/);assert.equal((await auth.status()).activeId,before.activeId);
}));
test('refreshes are single-flight and rotate credentials atomically; logout clears tokens and retains mapping',async()=>fixture(async({auth,grants,dir,getRevokes})=>{
 await login(auth);auth.active().expires_at=0;const values=await Promise.all([auth.accessToken(),auth.accessToken(),auth.accessToken()]);assert.deepEqual(values,['refreshed-access','refreshed-access','refreshed-access']);assert.equal(grants.filter(f=>f.get('grant_type')==='refresh_token').length,1);
 const saved=JSON.parse(await readFile(join(dir,'accounts.json'),'utf8'));assert.equal(saved.accounts[0].refresh_token,'rotated-refresh');assert.equal((await auth.logout()).revoked,true);assert.equal(getRevokes(),1);assert.equal((await auth.status()).signedIn,false);const file=await readFile(join(dir,'accounts.json'),'utf8');assert.ok(!file.includes('refreshed-access'));assert.ok(!file.includes('rotated-refresh'));assert.ok(file.includes('issued-client'));
}));
test('logout warns if remote revocation was not confirmed',async()=>fixture(async({auth})=>{await login(auth);const result=await auth.logout();assert.equal(result.revoked,false);assert.match(result.message,/not confirmed/);assert.equal((await auth.status()).signedIn,false);},{revokeStatus:503}));

test('logout waits for refresh rotation and revokes the newest renewable session',async()=>fixture(async({auth,grants})=>{await login(auth);auth.active().expires_at=0;const refreshing=auth.accessToken();await new Promise(r=>setTimeout(r,2));const signedOut=auth.logout();await refreshing;assert.equal((await signedOut).revoked,true);const revoked=grants.find(f=>f.get('token_type_hint')==='refresh_token');assert.equal(revoked.get('token'),'rotated-refresh');assert.equal((await auth.status()).signedIn,false);}));

test('a pending login resumes for its initiating browser without issuing another registration',async()=>fixture(async({auth,grants})=>{
 const first=await auth.start(null,'browser-binding');assert.equal(await auth.resume('browser-binding'),first);assert.equal(grants.length,0);
 await assert.rejects(auth.resume('wrong-browser'),/another browser/);
 auth.pending.expires=Date.now()-1;await assert.rejects(auth.resume('browser-binding'),/expired/);
}));
