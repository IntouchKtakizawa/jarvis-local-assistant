import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {OllamaProvider,SYSTEM} from '../server/ollama.js';
async function fixture(handler,fn){const server=http.createServer(handler);await new Promise(r=>server.listen(0,'127.0.0.1',r));try{await fn(new OllamaProvider(`http://127.0.0.1:${server.address().port}`,'default-model'));}finally{await new Promise(r=>server.close(r));}}
test('streams split UTF-8 and NDJSON; forwards chosen model and safe system context',async()=>{
  await fixture(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;const data=JSON.parse(body);assert.equal(data.model,'alternative');assert.equal(data.messages[0].content,SYSTEM);assert.deepEqual(data.messages[1],{role:'user',content:'hello'});const b=Buffer.from(JSON.stringify({message:{content:'Good evening, there ✳'}})+'\n'+JSON.stringify({done:true,eval_count:5}));res.write(b.subarray(0,15));res.write(b.subarray(15,b.length-3));res.end(b.subarray(b.length-3));},async provider=>{const events=[];for await(const event of provider.chat([{role:'user',content:'hello'}],'alternative'))events.push(event);assert.deepEqual(events,[{type:'token',content:'Good evening, there ✳'},{type:'done',tokens:5}]);});
});
test('incomplete stream is an error, never a successful reply',async()=>{await fixture((req,res)=>res.end('{"message":{"content":"Partial"}}\n'),async p=>{await assert.rejects(async()=>{for await(const event of p.chat([{role:'user',content:'hello'}])){}},/before completion/);});});
test('Ollama errors remain actionable',async()=>{await fixture((req,res)=>{res.writeHead(404);res.end('model not found');},async p=>{await assert.rejects(async()=>{for await(const event of p.chat([{role:'user',content:'hello'}])){}},/404: model not found/);});});
test('surfaces an error inside a successful HTTP stream',async()=>{await fixture((req,res)=>res.end('{"error":"model requires more memory"}\n'),async p=>{await assert.rejects(async()=>{for await(const event of p.chat([{role:'user',content:'hello'}])){}},/requires more memory/);});});
