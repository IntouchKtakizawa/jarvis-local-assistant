import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {publicURL} from './web.js';
export const BUILTINS=[
 {id:'web',name:'Web research',icon:'◎',description:'Search the internet and read public web pages.',network:true},
 {id:'images',name:'Image gallery',icon:'▧',description:'Find real photos and display them inline.',network:true},
 {id:'maps',name:'Interactive maps',icon:'⌖',description:'Explore places with pan and zoom.',network:true},
 {id:'weather',name:'Weather',icon:'☀',description:'Live temperatures, hourly graphs and a 7-day forecast.',network:true},
 {id:'planner',name:'Local planner',icon:'▦',description:'Open your editable seven-day calendar. Google sync is separate.',network:false},
 {id:'information',name:'Visual answers',icon:'◇',description:'Research a topic and build an illustrated information card.',network:true},
 {id:'calculator',name:'Calculator',icon:'∑',description:'Evaluate arithmetic accurately on this Mac.',network:false},
 {id:'notes',name:'Notes',icon:'▤',description:'Create, search and reopen local notes.',network:false},
 {id:'memory',name:'Personal memory',icon:'✧',description:'Remember facts you explicitly ask Jarvis to save. View or delete them any time.',network:false}
];
const fresh=()=>({version:1,enabled:Object.fromEntries(BUILTINS.map(a=>[a.id,true])),custom:[],memory:[],notes:[],chats:[]});
export function validateAddon(value){
 if(!value||typeof value!=='object')throw new Error('Import an add-on JSON document.');
 const id=String(value.id||'');if(!/^[a-z][a-z0-9_]{2,35}$/.test(id)||BUILTINS.some(a=>a.id===id))throw new Error('Add-on id must use 3–36 lowercase letters, numbers or underscores, and be unique.');
 if(typeof value.name!=='string'||!value.name.trim()||typeof value.description!=='string')throw new Error('The add-on needs a name and description.');
 const endpoint=publicURL(value.endpoint);if(!endpoint)throw new Error('Add-ons must use a public HTTPS JSON endpoint.');
 const parameters=value.parameters||{};if(typeof parameters!=='object'||Array.isArray(parameters)||Object.keys(parameters).length>8)throw new Error('Use at most eight named query parameters.');
 for(const [key,description]of Object.entries(parameters))if(!/^[a-z][a-z0-9_]{0,35}$/.test(key)||typeof description!=='string'||description.length>300)throw new Error('Parameters must have simple names and text descriptions.');
 return {id,name:value.name.trim().slice(0,60),description:value.description.slice(0,500),endpoint,parameters,network:true,icon:'⊞',custom:true};
}
export class Workspace{
 constructor(dir){this.dir=dir;this.queue=Promise.resolve();}
 path(account){return join(this.dir,createHash('sha256').update(account).digest('hex')+'.json');}
 async load(account){await mkdir(this.dir,{recursive:true,mode:0o700});try{const d=JSON.parse(await readFile(this.path(account),'utf8'));return {...fresh(),...d,enabled:{...fresh().enabled,...d.enabled}};}catch(e){if(e.code==='ENOENT')return fresh();throw new Error('Could not read your local workspace. Your saved file has been preserved.');}}
 async get(account){await this.queue.catch(()=>{});return this.load(account);}
 update(account,fn){const task=this.queue.catch(()=>{}).then(async()=>{const state=await this.load(account);const result=await fn(state);const tmp=this.path(account)+'.'+randomUUID()+'.tmp';await writeFile(tmp,JSON.stringify(state),{mode:0o600});await rename(tmp,this.path(account));return result;});this.queue=task;return task;}
 async action(account,data){
  if(!data||typeof data.action!=='string')throw new Error('Choose a workspace action.');
  if(data.action==='getChat'){const s=await this.get(account);return s.chats.find(c=>c.id===data.id)||null;}
  return this.update(account,s=>{
   if(data.action==='settings'){for(const [id,enabled]of Object.entries(data.enabled||{})){if(typeof enabled==='boolean'&&(BUILTINS.some(a=>a.id===id)||s.custom.some(a=>a.id===id)))s.enabled[id]=enabled;}return {enabled:s.enabled};}
   if(data.action==='install'){const addon=validateAddon(data.manifest);if(s.custom.some(a=>a.id===addon.id))throw new Error('An add-on with this id is already installed.');if(s.custom.length>=12)throw new Error('Remove an add-on before installing more than twelve.');s.custom.push(addon);s.enabled[addon.id]=false;return addon;}
   if(data.action==='uninstall'){s.custom=s.custom.filter(a=>a.id!==data.id);delete s.enabled[data.id];return {ok:true};}
   if(data.action==='remember'){if(typeof data.text!=='string'||!data.text.trim()||data.text.length>1000)throw new Error('Use a memory up to 1,000 characters.');const existing=s.memory.find(m=>m.text.toLowerCase()===data.text.trim().toLowerCase());if(existing)return existing;if(s.memory.length>=100)throw new Error('Memory is full. Remove an older fact first.');const item={id:randomUUID(),text:data.text.trim(),createdAt:new Date().toISOString()};s.memory.push(item);return item;}
   if(data.action==='forget'){s.memory=s.memory.filter(m=>m.id!==data.id);return {ok:true};}
   if(data.action==='saveNote'){if(typeof data.title!=='string'||!data.title.trim()||typeof data.content!=='string'||data.content.length>20000)throw new Error('A note needs a title and up to 20,000 characters.');const existing=s.notes.find(n=>n.title===data.title.slice(0,150)&&n.content===data.content);if(existing)return existing;if(s.notes.length>=100)throw new Error('Your notebook is full. Remove a note first.');const note={id:randomUUID(),title:data.title.slice(0,150),content:data.content,updatedAt:new Date().toISOString()};s.notes.unshift(note);return note;}
   if(data.action==='deleteNote'){s.notes=s.notes.filter(n=>n.id!==data.id);return {ok:true};}
   if(data.action==='saveChat'){
    const c=data.chat;if(!c||typeof c.id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(c.id)||!Array.isArray(c.history)||c.history.length>78||!Array.isArray(c.turns)||c.turns.length>80)throw new Error('Invalid conversation.');
    if(c.history.some(m=>!['user','assistant'].includes(m.role)||typeof m.content!=='string'||m.content.length>50000))throw new Error('Invalid conversation messages.');
    const chat={id:c.id,title:String(c.title||'New conversation').slice(0,90),history:c.history,turns:c.turns,updatedAt:new Date().toISOString()};if(JSON.stringify(chat).length>1300000)throw new Error('This conversation is too large to save. Export it before starting a new chat.');s.chats=s.chats.filter(x=>x.id!==chat.id);s.chats.unshift(chat);s.chats=s.chats.slice(0,30);return {id:chat.id,updatedAt:chat.updatedAt};
   }
   if(data.action==='deleteChat'){s.chats=s.chats.filter(c=>c.id!==data.id);return {ok:true};}
   throw new Error('Unknown workspace action.');
  });
 }
 async overview(account){const s=await this.get(account);return {addons:[...BUILTINS,...s.custom].map(a=>({...a,enabled:s.enabled[a.id]!==false})),memory:s.memory,notes:s.notes,chats:s.chats.map(({id,title,updatedAt})=>({id,title,updatedAt}))};}
}
