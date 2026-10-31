import test from 'node:test';
import assert from 'node:assert/strict';
import {imageRequest} from '../public/intents.js';
const user=content=>({role:'user',content});
test('natural image requests dispatch to a gallery, including the exact reported phrase',()=>{
 for(const phrase of ['pull me images of dogs','pull up images of dogs','show me some images of dogs','fetch pictures of dogs','display photos of dogs','images of dogs','can you get me pictures of dogs please'])assert.equal(imageRequest([user(phrase)]).query,'dogs',phrase);
 assert.equal(imageRequest([user('get dog photos')]).query,'dog');assert.equal(imageRequest([user('Show me a picture map of Thailand')]),null);assert.equal(imageRequest([user('Explain image compression')]),null);
});
test('display follow-ups reuse the preceding image topic without relying on the model',()=>{
 const history=[user('pull me images of dogs'),{role:'assistant',content:'Here is a link.'}];
 for(const phrase of ['pull it up directly here','show them here','display the images inline','put them in this chat'])assert.equal(imageRequest([...history,user(phrase)]).query,'dogs',phrase);
 assert.equal(imageRequest([user('hello'),user('pull it up directly here')]),null);
});
test('image command particles can occur before or after me, with varied polite phrasing',()=>{
 const phrases=['pull me up images of mars','pull up me images of mars','bring me up pictures of mars','could you pull me up some images of mars please','I want to see images of mars','I would like pictures of mars','can you show me mars images','give me photos of mars','yo jarvis pull me up images of mars'];
 for(const text of phrases)assert.equal(imageRequest([user(text)])?.query,'mars',text);
});
