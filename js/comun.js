// Utilidades comunes a todos los módulos (Cartón, Hojas single, …): selección, formato, fechas y semanas.
const $=s=>document.querySelector(s);
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=v=>parseFloat(String(v).replace(',','.'))||0;
const fmt=n=>n.toFixed(2),sgm=d=>(d>0?'+':'')+d.toFixed(2),r3=x=>Math.round(x*1000)/1000;
// Variación % = (real − esperado) / esperado × 100
const vp=(R,E)=>E?(R-E)/E*100:null,pct=(R,E)=>{const v=vp(R,E);return v==null?'—':(v>0?'+':'')+v.toFixed(1)+' %'};
const p2=n=>String(n).padStart(2,'0'),ymd=d=>d.getFullYear()+'-'+p2(d.getMonth()+1)+'-'+p2(d.getDate());
const parseISO=s=>{const m=String(s).match(/^(\d{4})-(\d\d)-(\d\d)/);return m?new Date(+m[1],m[2]-1,+m[3]):new Date()};
function isoWeek(d){d=new Date(Date.UTC(d.getFullYear(),d.getMonth(),d.getDate()));const n=d.getUTCDay()||7;d.setUTCDate(d.getUTCDate()+4-n);const y=d.getUTCFullYear();return y+'-S'+p2(Math.ceil(((d-Date.UTC(y,0,1))/864e5+1)/7))}
function isoDate(v){
  if(v instanceof Date){const d=new Date(v.getTime()+432e5);return ymd(d)}
  if(typeof v==='number'){const d=new Date(Math.round((v-25569)*864e5));return d.getUTCFullYear()+'-'+p2(d.getUTCMonth()+1)+'-'+p2(d.getUTCDate())}
  const s=String(v||'');if(/^\d{4}-\d\d-\d\d/.test(s))return s.slice(0,10);
  const m=s.match(/(\d+)\/(\d+)\/(\d+)/);if(m)return(m[3].length<4?'20'+m[3]:m[3])+'-'+p2(m[2])+'-'+p2(m[1]);
  return ymd(new Date());
}

/* ==== ALERTAS DESCARTADAS (Cartón y Hojas single) ====
   Administración puede descartar una alerta con «×». Se identifica por su texto: si la situación cambia (otro número de OP,
   otros modelos…) la alerta vuelve a aparecer. Se guarda en la configuración de la app (la ven todos los administradores);
   en modo local, en este navegador. */
let ALO={};
const aloKey=html=>{const t=String(html).replace(/<[^>]*>/g,'').replace(/\s+/g,' ').trim();let h=5381;for(let i=0;i<t.length;i++)h=((h<<5)+h+t.charCodeAt(i))|0;return'a'+(h>>>0).toString(36)};
async function alertasLeer(){try{if(NUBE){const {data}=await SBC.from('config').select('v').eq('k','alertas_ocultas');ALO=data&&data[0]&&data[0].v&&typeof data[0].v==='object'?data[0].v:{}}
  else ALO=JSON.parse(localStorage.getItem('alertas_ocultas')||'{}')||{}}catch(e){ALO={}}}
async function alertasGuardar(){if(NUBE){const {error}=await SBC.from('config').upsert([{k:'alertas_ocultas',v:ALO,updated_at:new Date().toISOString()}],{onConflict:'k'});if(error)throw new Error(error.message)}
  else localStorage.setItem('alertas_ocultas',JSON.stringify(ALO))}
// Descarta (on=true) o restaura una o varias alertas; relee antes para no pisar lo que descartó otro administrador.
async function alertasMarcar(keys,on){await alertasLeer();keys.forEach(k=>{if(on)ALO[k]={por:typeof quien==='function'?quien():'',ts:Date.now()};else delete ALO[k]});
  // limpieza: lo descartado hace más de 120 días ya no se guarda
  const lim=Date.now()-120*864e5;Object.keys(ALO).forEach(k=>{if(!(ALO[k]&&ALO[k].ts>lim))delete ALO[k]});await alertasGuardar()}
// Divide una lista de alertas [*, html, …] (el html en la posición i) en visibles y descartadas.
const alertasSeparar=(A,i)=>{const vis=[],ocu=[];A.forEach(a=>(ALO[aloKey(a[i])]?ocu:vis).push(a));return{vis,ocu}};
const aloBtn=html=>`<button class="aloff w" type="button" data-aloff="${aloKey(html)}" title="Descartar esta alerta" aria-label="Descartar alerta">×</button>`;
const aloRest=(ocu,i)=>ocu.length?`<p class="mut" style="margin:6px 0 0">${ocu.length} alerta(s) descartada(s) · <a href="#" class="w" data-alon="${ocu.map(a=>aloKey(a[i])).join(',')}">Volver a mostrar</a></p>`:'';
