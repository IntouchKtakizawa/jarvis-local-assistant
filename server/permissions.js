// Model-originated persistence needs explicit authorization in the current user turn.
// External writes are deliberately absent from this registry. Future integrations
// must add a real confirmation flow before exposing consequential operations.
export function authorizeTool(name, request) {
 // Quoted examples, code and blockquotes cannot grant permission to write.
 request=request.replace(/```[\s\S]*?(?:```|$)/g,'').replace(/^\s*>.*$/gm,'').replace(/`[^`]*`|"[^"\n]*"|“[^”\n]*”|'[^'\n]*'/g,'').replace(/[’‘]/g,"'");
 const writes=['remember_fact','save_note','save_project_context'];
 if(!writes.includes(name))return;
 if(/\b(do not|don't|never)\s+(?:\w+\s+){0,5}(remember|save|store|persist|write|update)\b/i.test(request))throw new Error('The user asked not to persist this information.');
 const command=String.raw`(?:^|[.!?;]\s+|\band\s+)(?:(?:please|also)\s+|(?:can|could|would|will) you\s+|I (?:want|would like) you to\s+)*`;
 const permits=pattern=>new RegExp(command+pattern,'i').test(request);
 if(name==='remember_fact'&&!permits(String.raw`(?:remember\s+(?!(?:how|when|what|where|why|whether)\b)|(?:save|store)\b[^.!?;]*\bmemory\b)`))throw new Error('Saving memory requires an explicit request to remember it.');
 if(name==='save_note'&&!permits(String.raw`(?:save|write|create|take|add|update)\b[^.!?;]*\bnotes?\b`))throw new Error('Saving a note requires an explicit request.');
 if(name==='save_project_context'&&!permits(String.raw`(?:save|remember|persist|update|store)\b[^.!?;]*\b(?:projects?|context|decisions?|architecture|progress|record)\b`))throw new Error('Saving a project record requires an explicit request.');
}
