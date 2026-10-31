const el=(tag,cls,text)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;};
export function renderMap(data,reply){
 const card=el('section','map-card'),header=el('div','panel-heading'),copy=el('div');copy.append(el('div','visual-eyebrow','EXPLORE · INTERACTIVE MAP'),el('h3','',data.title),el('p','',data.description));
 const external=el('a','panel-link','Open map ↗');external.href=data.source;external.target='_blank';external.rel='noopener noreferrer';header.append(copy,external);
 const surface=el('div','map-surface');surface.setAttribute('aria-label',`Interactive map of ${data.title}`);const foot=el('div','map-foot');foot.append(el('span','','Drag to explore · + / − to zoom'));const reset=el('button','panel-link','Reset view');reset.type='button';foot.append(reset);card.append(header,surface,foot);reply.el.insertBefore(card,reply.content);
 if(!window.L){surface.textContent='The map library did not load. Refresh Jarvis to try again.';return;}
 const map=L.map(surface,{scrollWheelZoom:false});const [south,north,west,east]=data.bounds;const fit=()=>map.fitBounds([[south,west],[north,east]],{padding:[22,22],maxZoom:14});fit();
 const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,referrerPolicy:'strict-origin-when-cross-origin',attribution:'© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap contributors</a>'});let loaded=0;
 tiles.on('tileload',()=>{loaded++;surface.dataset.loaded=String(loaded);});tiles.on('tileerror',()=>{if(!loaded){foot.firstChild.textContent='Map tiles are unavailable. Use Open map to view this place.';}});tiles.addTo(map);
 const marker=L.circleMarker([data.lat,data.lon],{radius:7,color:'#fff',weight:2,fillColor:'#168ebd',fillOpacity:1}).addTo(map);const label=el('strong','',data.title);marker.bindPopup(label);
 reset.addEventListener('click',fit);const observer=new ResizeObserver(()=>map.invalidateSize());observer.observe(surface);card.addEventListener('jarvis-dispose',()=>{observer.disconnect();map.remove();},{once:true});setTimeout(()=>map.invalidateSize(),50);
}
