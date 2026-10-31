// Model-originated persistence needs explicit authorization in the current user turn.
// External writes are deliberately absent from this registry. Future integrations
// must add a real confirmation flow before exposing consequential operations.
export function authorizeTool(name, request) {
 const writes=['remember_fact','save_note','save_project_context'];
 if(writes.includes(name)&&/\b(do not|don't|never)\s+(?:\w+\s+){0,2}(remember|save|store|persist|write|update)\b/i.test(request))throw new Error('The user asked not to persist this information.');
 if(name==='remember_fact'&&!/\b(remember|save .*memory|store .*memory)\b/i.test(request))throw new Error('Saving memory requires an explicit request to remember it.');
 if(name==='save_note'&&!/\b(save|write|create|take|add|update)\b[\s\S]*\bnotes?\b/i.test(request))throw new Error('Saving a note requires an explicit request.');
 if(name==='save_project_context'&&!/\b(save|remember|persist|update|store)\b[\s\S]*\b(project|context|decision|architecture|progress|record)\b/i.test(request))throw new Error('Saving a project record requires an explicit request.');
}
