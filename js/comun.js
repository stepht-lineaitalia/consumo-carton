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
