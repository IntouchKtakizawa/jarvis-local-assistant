import {mkdir,readFile,writeFile,rename} from 'node:fs/promises';
import {randomBytes,createHash,timingSafeEqual} from 'node:crypto';
import {join} from 'node:path';
const hash=value=>createHash('sha256').update(value).digest('hex');
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export class BrowserBridge{
 constructor(dir,{origins=['https://intouchktakizawa.github.io'],now=Date.now}={}){this.dir=dir;this.origins=new Set(origins);this.now=now;this.devices=[];this.attempts=[];this.pending=null;this.writes=Promise.resolve();this.ready=this.load();}
 async load(){await mkdir(this.dir,{recursive:true,mode:0o700});try{const d=JSON.parse(await readFile(join(this.dir,'devices.json'),'utf8'));this.devices=Array.isArray(d)?d:[];}catch(e){if(e.code!=='ENOENT')throw new Error('Cannot read paired browser storage.');}}
 async save(){const data=JSON.stringify(this.devices);this.writes=this.writes.catch(()=>{}).then(async()=>{const path=join(this.dir,'devices.json');await writeFile(path+'.tmp',data,{mode:0o600});await rename(path+'.tmp',path);});await this.writes;}
 code(account){const value=randomBytes(6).toString('hex').toUpperCase();this.pending={hash:hash(value),account,expires:this.now()+600000};return {code:value.match(/.{1,4}/g).join('-'),expiresAt:new Date(this.pending.expires).toISOString(),origins:[...this.origins]};}
 async pair({code,label,origin,account}){await this.ready;if(!this.origins.has(origin))throw new Error('This website is not allowed to pair.');this.attempts=this.attempts.filter(t=>t>this.now()-600000);if(this.attempts.length>=8)throw new Error('Too many pairing attempts. Try again in ten minutes.');this.attempts.push(this.now());const value=typeof code==='string'?code.replace(/[^a-z0-9]/gi,'').toUpperCase():'';if(!this.pending||this.pending.expires<this.now()||this.pending.account!==account||!equal(this.pending.hash,hash(value)))throw new Error('Pairing code is incorrect or expired. Generate a fresh code in the local app.');const token=randomBytes(32).toString('base64url');this.devices=this.devices.filter(d=>d.createdAt>this.now()-90*86400000);this.devices.push({id:randomBytes(12).toString('hex'),hash:hash(token),origin,account,label:String(label||'GitHub Pages browser').slice(0,80),createdAt:this.now()});this.devices=this.devices.slice(-12);this.pending=null;await this.save();return {token};}
 async authorized(token,origin,account){await this.ready;if(typeof token!=='string'||token.length>200)return false;return this.devices.some(d=>d.origin===origin&&d.account===account&&d.createdAt>this.now()-90*86400000&&equal(d.hash,hash(token)));}
 async list(account){await this.ready;return this.devices.filter(d=>d.account===account).map(({id,label,createdAt,origin})=>({id,label,createdAt,origin}));}
 async revoke(id,account){await this.ready;this.devices=this.devices.filter(d=>!(d.id===id&&d.account===account));await this.save();}
}
