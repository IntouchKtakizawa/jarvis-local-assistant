import {mkdir,open,readFile,unlink} from 'node:fs/promises';
import {unlinkSync} from 'node:fs';
import {join} from 'node:path';
// One process owns token refresh/rotation for this credential directory.
export async function lockRuntime(dir){
  await mkdir(dir,{recursive:true,mode:0o700});const path=join(dir,'runtime.lock');
  for(let attempt=0;attempt<3;attempt++){
    try{const file=await open(path,'wx',0o600);await file.writeFile(String(process.pid));await file.close();process.once('exit',()=>{try{unlinkSync(path);}catch{}});return;}
    catch(e){if(e.code!=='EEXIST')throw e;let pid;try{pid=Number(await readFile(path,'utf8'));}catch{continue;}
      if(!Number.isSafeInteger(pid)||pid<1)throw new Error('JARVIS runtime lock is invalid. Check that no other JARVIS server is running before removing .local/auth/runtime.lock.');
      let running=true;try{process.kill(pid,0);}catch(e){if(e.code==='ESRCH')running=false;}
      if(running)throw new Error('Another JARVIS server already owns this sign-in storage. Stop it before starting another.');
      try{await unlink(path);}catch(e){if(e.code!=='ENOENT')throw e;}
    }
  }throw new Error('Could not acquire JARVIS runtime lock.');
}
