import {mkdir,rm,cp,readFile,writeFile,readdir} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const revision=createHash('sha256').update(await readFile(new URL('../public/app.js',import.meta.url))).update(await readFile(new URL('../public/connection.js',import.meta.url))).update(await readFile(new URL('../public/futuristic.css',import.meta.url))).update(await readFile(new URL('../public/index.html',import.meta.url))).update(await readFile(new URL('../public/floating-ui.js',import.meta.url))).update(await readFile(new URL('../public/ui-spec.js',import.meta.url))).update(await readFile(new URL('../public/ui-math.js',import.meta.url))).digest('hex').slice(0,12);
const root=resolve(import.meta.dirname,'..'),dist=join(root,'dist');
await rm(dist,{recursive:true,force:true});await mkdir(dist,{recursive:true});
await cp(join(root,'public'),dist,{recursive:true,filter:source=>!source.endsWith('doge.png')});
const vendors={'leaflet.js':'leaflet/dist/leaflet.js','leaflet.css':'leaflet/dist/leaflet.css','marked.js':'marked/lib/marked.esm.js','purify.js':'dompurify/dist/purify.es.mjs'};await mkdir(join(dist,'vendor'),{recursive:true});
for(const [name,source]of Object.entries(vendors))await cp(join(root,'node_modules',source),join(dist,'vendor',name));
await cp(join(root,'node_modules/leaflet/dist/images'),join(dist,'vendor/images'),{recursive:true});
async function rewrite(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory()){if(entry.name!=='vendor')await rewrite(file);continue;}if(!/\.(js|html|css)$/.test(file))continue;let s=await readFile(file,'utf8');if(entry.name==='index.html')s=s.replace(/(href|src)="\/(?!\/)/g,'$1="./');if(entry.name==='connection.js')s=s.replace(/const local=.*?;/,'const local=false;');s=s.replace(/from '\/vendor\//g,"from './vendor/").replace(/replaceState\(null,'','\/\?/g,"replaceState(null,'','./?").replace(/replaceState\(null,'','\/'\)/g,"replaceState(null,'','./')");s=s.replace(/(from\s+['"])(\.\/[^'"]+\.js)(['"])/g,`$1$2?v=${revision}$3`).replace(/((?:src|href)=")([^"]+\.(?:js|css))(")/g,`$1$2?v=${revision}$3`);await writeFile(file,s);}}
await rewrite(dist);await writeFile(join(dist,'.nojekyll'),'');
const index=await readFile(join(dist,'index.html'),'utf8');if(/(?:src|href)="\/(?!\/)/.test(index))throw new Error('Root-relative assets would break on a GitHub project site.');
console.log('Built GitHub Pages interface in dist/. Private backend data and credentials are excluded.');
