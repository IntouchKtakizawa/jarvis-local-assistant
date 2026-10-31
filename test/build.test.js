import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,cp,mkdir,symlink,readFile,writeFile,appendFile,readdir,rm} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';

test('editing an imported UI module invalidates the static revision without publishing private data',async()=>{
 const root=resolve(import.meta.dirname,'..'),dir=await mkdtemp(join(tmpdir(),'jarvis-build-test-'));
 try{
  await cp(join(root,'public'),join(dir,'public'),{recursive:true});await mkdir(join(dir,'scripts'));
  await cp(join(root,'scripts/build-pages.js'),join(dir,'scripts/build-pages.js'));
  for(const name of ['package.json','package-lock.json'])await cp(join(root,name),join(dir,name));
  await symlink(join(root,'node_modules'),join(dir,'node_modules'),'dir');
  await writeFile(join(dir,'.env'),'private fixture');await mkdir(join(dir,'.local'));await writeFile(join(dir,'.local/private.json'),'{}');
  const build=()=>promisify(execFile)(process.execPath,[join(dir,'scripts/build-pages.js')]);
  const revision=async()=>{const html=await readFile(join(dir,'dist/index.html'),'utf8');const match=html.match(/app\.js\?v=([a-f0-9]+)/);assert.ok(match);assert.ok(!/(?:src|href)="\/(?!\/)/.test(html));return match[1];};
  await build();const before=await revision();
  await appendFile(join(dir,'public/workspace-ui.js'),'\n// Changed imported module fixture.\n');
  await build();assert.notEqual(await revision(),before);
  const output=await readdir(join(dir,'dist'));for(const name of ['.local','.env','server','node_modules'])assert.ok(!output.includes(name));
 }finally{await rm(dir,{recursive:true,force:true});}
});
