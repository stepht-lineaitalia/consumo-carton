// Módulo COMPARATIVO DE CONSUMOS (solo Administración): cartón y hojas single de una OP o un modelo, lado a lado.
// Solo LEE lo que ya calculan Cartón (reports, est) y Hojas single (hsDatos); nunca suma ni mezcla m² con hojas.
// Se carga después de hojas.js y antes de app.js.

// Una fila por OP con lo de cada material. Cartón: último registro de la OP (si hay varios, se indica).
function cmpDatos(){
  const C={};vis().filter(r=>r.kind==='op').sort((a,b)=>a.ts-b.ts).forEach(r=>{const o=C[r.op]||(C[r.op]={n:0,rs:[]});o.n++;o.r=r;o.rs.push(r)});
  const H={};hsDatos().forEach(x=>H[x.op]=x);
  return[...new Set([...Object.keys(C),...Object.keys(H)])].map(op=>{const c=C[op],h=H[op],r=c&&c.r;
    const e=r?est(r):null,cDif=!!e&&e.cls==='bad'&&!esExcep(r),hReg=!!(h&&h.r),hDif=!!h&&(h.k==='mas'||h.k==='menos');
    // «Corregida»: cada material que necesitaba corrección ya tiene la marca (Cartón: Corregido · Hojas: Corregido).
    const cNec=!!r&&porCorregir(r),cOk=cNec&&!!r.corr,hNec=!!h&&hsPorCorregir(h),hOk=hNec&&!!h.r.rev,corregida=(cNec||hNec)&&(!cNec||cOk)&&(!hNec||hOk);
    return{cOk,hOk,corregida,op,modelo:(r&&r.modelo)||(h&&h.modelo)||'',fecha:(h&&h.fecha)||(r&&r.venc)||'',area:h&&h.area||'',c:r?{r,e,n:c.n,rs:c.rs,u:cmpUnir(c.rs)}:null,h:h||null,hReg,cDif,hDif,
      ult:Math.max(r?r.ts:0,hReg?h.r.ts:0)}});
}
const cmpCelC=x=>x.c?chipE(x.c.e,(EST[x.c.e.k]||{}).s||x.c.e.t)+(x.cOk?' <span class="c-ok" title="Corregido">✓</span>':''):'<span class="chip st st-pend">Sin registro</span>';
const cmpCelH=x=>x.hReg?hsChip(x.h.k)+(x.hOk?' <span class="c-ok" title="Corregido">✓</span>':''):x.h?'<span class="chip st st-pend">Pendiente</span>':'<span class="chip st st-pend">Sin registro</span>';
// Consumo «sin programar en ERP» (Rsp) va aparte, igual que en el Tablero: «+X sin programar» en morado.
const cmpSp=r=>r.Rsp?`<span class="c-sinprog">+${fmt(r.Rsp)} sin programar</span>`:'';
const cmpDifC=x=>{if(!x.c)return'—';const r=x.c.u,d=r.R-r.E;if(r.Rsp&&!(r.E>0)&&!(r.R>0))return cmpSp(r);
  return`<span class="${d>0?'pos':d<0?'neg':''}">${sgm(d)}</span>`+(r.Rsp?'<br>'+cmpSp(r):'')};
const cmpDifH=x=>x.hReg&&x.h.difM!=null?`<span class="${x.h.difM>hsTol?'pos':x.h.difM<-hsTol?'neg':''}">${sgn(x.h.difM)}</span>`:'—';

// OP con varios registros de cartón (p. ej. OP doble consumo): se SUMAN los m² reales de todos los registros, por ancho.
// Los m² programados no se suman (es la misma programación del ERP): se toma el programado de cada ancho una sola vez.
// El estado (chip) y la corrección siguen siendo los del último registro.
function cmpUnir(rs){
  const last=rs[rs.length-1];if(rs.length<2)return last;
  const A={};rs.forEach(r=>(r.per||[]).forEach(p=>{const o=A[p.a]||(A[p.a]={a:p.a,E:0,R:0,Rsp:0,prog:false});
    if(pg(p)){o.prog=true;o.E=Math.max(o.E,p.E||0)}if(p.sp)o.Rsp+=p.R||0;else o.R+=p.R||0}));
  const W=Object.values(A).sort((a,b)=>a.a-b.a),S=k=>W.reduce((t,o)=>t+o[k],0);
  return{...last,multi:rs.length,W,E:S('E'),R:S('R'),Rsp:S('Rsp'),cr:rs.reduce((t,r)=>t+(r.cr||0),0),
    mcc:rs.flatMap(r=>r.mcc||[]),fechas:[...new Set(rs.map(r=>dmy(r.ts)))]};
}
function cmpDesgloseW(u){
  const F=[];u.W.forEach(o=>{
    if(o.prog||o.R>0){const f={p:o.prog?o.a:null,u:o.R>0?o.a:null,E:o.prog?o.E:null,R:o.R>0?o.R:null};
      if(!o.prog&&o.R>0){const m=u.mcc.find(m=>+m.a===+o.a);if(m)f.m=CMP_MOT[m.m]?m.m:'sin';else f.x='no programado'}
      F.push(f)}
    if(o.Rsp>0)F.push({p:o.prog?o.a:null,u:o.a,E:o.prog?0:null,R:o.Rsp,m:'sp'})});
  return cmpTablaD(F,{E:u.E,R:u.R+(u.Rsp||0),n:u.multi})}

// Desglose por cartón (m² totales de la OP): cartón programado | cartón real | m² programados | m² reales.
// Si hubo cambio, el cartón real va del color de su motivo (leyenda arriba, solo con los motivos que aparecen).
// Empareja igual que el Excel de registro: primero con el motivo guardado (de → a), luego en orden. Solo presenta.
const CMP_MOT={exist:'mot-exist',inc:'mot-inc',sin:'mot-sin',sp:'c-sinprog'};
function cmpDesglose(r){
  const P=(r.per||[]).filter(p=>!p.sp&&(pg(p)||p.R>0)),sp=(r.per||[]).filter(p=>p.sp&&p.R>0);
  const prog=P.filter(p=>pg(p)&&!(p.R>0)),usad=P.filter(p=>p.R>0&&!pg(p)),F=[];
  P.filter(p=>pg(p)&&p.R>0).forEach(p=>F.push({p:p.a,u:p.a,E:p.E,R:p.R}));
  (r.mcc||[]).forEach(m=>{const i=prog.findIndex(p=>+p.a===+m.de),j=usad.findIndex(p=>+p.a===+m.a);
    if(i>=0&&j>=0){const b=prog.splice(i,1)[0],c=usad.splice(j,1)[0];F.push({p:b.a,u:c.a,E:b.E,R:c.R,m:CMP_MOT[m.m]?m.m:'sin'})}});
  while(prog.length&&usad.length){const b=prog.shift(),c=usad.shift();F.push({p:b.a,u:c.a,E:b.E,R:c.R,m:'sin'})}
  prog.forEach(p=>F.push({p:p.a,E:p.E,R:null}));
  usad.forEach(p=>F.push({u:p.a,R:p.R,x:'no programado'}));
  // Sin programar en ERP: en morado. Si el cartón venía en el ERP con 0 m², se muestra como programado.
  sp.forEach(p=>F.push({p:pg(p)?p.a:null,u:p.a,E:pg(p)?0:null,R:p.R,m:'sp'}));
  return cmpTablaD(F)}
// Tabla del desglose (con renglón de total cuando la OP suma varios registros).
function cmpTablaD(F,T){
  if(!F.length)return'';
  const m=v=>v>0?fmt(v):v===0?fmt(0):'—',cm=a=>a!=null?a+' cm':'—';
  const usados=[...new Set(F.filter(f=>f.m).map(f=>f.m))].sort((a,b)=>['exist','inc','sin','sp'].indexOf(a)-['exist','inc','sin','sp'].indexOf(b));
  const xs=[...new Set(F.filter(f=>f.x).map(f=>f.x))],ley=usados.length||xs.length?`<div class="cmpley">${usados.map(k=>`<span><i class="${CMP_MOT[k]}"></i>${k==='sin'?'Sin motivo registrado':k==='sp'?'Sin programar en ERP':esc(MOTIVOS[k])}</span>`).join('')}${xs.length?`<span>* ${xs.join(' · ')}</span>`:''}</div>`:'';
  return`<table class="cmpd"><thead><tr><th>Cartón programado</th><th>Cartón real</th><th>m² programa</th><th>m² reales</th></tr></thead><tbody>${F.map(f=>
    `<tr><td>${cm(f.p)}</td><td${f.m?` class="${CMP_MOT[f.m]}"`:''}${f.x?` title="${f.x}"`:''}>${cm(f.u)}${f.x?'<sup>*</sup>':''}</td><td>${m(f.E)}</td><td>${m(f.R)}</td></tr>`).join('')}</tbody>${T?`<tfoot><tr><th colspan="2">Total (${T.n} registros)</th><th>${fmt(T.E)}</th><th>${fmt(T.R)}</th></tr></tfoot>`:''}</table>${ley}`}

// Tarjetas de una OP: cartón | hojas single.
// Comentarios de las capturas de cartón (v5.16). Un registro: «• Comentario: …». Varios: cada comentario con su fecha.
const cmpComC=c=>{const L=(c.rs||[c.r]).filter(r=>(r.com||'').trim());if(!L.length)return'';
  return L.length===1&&c.n===1?`<div class="line">• Comentario: ${esc(L[0].com.trim())}</div>`
    :`<div class="line">• ${L.length>1?'Comentarios':'Comentario'}: ${L.map(r=>`<span class="mut">${dmy(r.ts)}</span> ${esc(r.com.trim())}`).join(' · ')}</div>`};
function cmpTarjetas(x){
  const kp=(t,v,c)=>`<div class="kpi"><span class="mut">${t}</span><b class="${c||''}">${v}</b></div>`;
  let cc='<p class="mut">Esta OP no tiene registro de cartón.</p>';
  if(x.c){const r=x.c.u,d=r.R-r.E,todoSp=!!r.Rsp&&!(r.E>0)&&!(r.R>0);
    cc=`${chipE(x.c.e)}<div class="kpis cmpk">${todoSp?kp('m² esperados','Sin programar','c-sinprog')+kp('m² reales',fmt(r.Rsp))+kp('Diferencia','—')
      :kp('m² esperados',fmt(r.E))+kp('m² reales',fmt(r.R))+kp('Diferencia',`${sgm(d)} <span class="mut" style="font-size:13px">(${pct(r.R,r.E)})</span>`,d>0?'pos':d<0?'neg':'')}</div>
    ${r.Rsp&&!todoSp?`<div class="line">• ${cmpSp(r).replace('sin programar','m² sin programar')}</div>`:''}
    ${r.multi?cmpDesgloseW(r):cmpDesglose(r)}<div class="line">• Cajas: ${r.ce||0} → ${r.cr||0}</div>${cmpComC(x.c)}
    ${x.c.n>1?`<div class="line pos">• La OP tiene ${x.c.n} registros de cartón (los m² son la suma de todos; el estado es el del último).</div>`:''}<div class="line mut">• Registrado ${r.fechas?r.fechas.length>1?r.fechas.slice(0,-1).join(', ')+' y '+r.fechas[r.fechas.length-1]:r.fechas[0]+` (${x.c.n} veces)`:dmy(r.ts)}</div>
    <a href="#" class="cmplk" data-cmpc="${esc(x.op)}">Ver en Cartón → Tablero</a>`}
  let hh='<p class="mut">Esta OP no viene en el programa de hojas single.</p>';
  if(x.h){const h=x.h;
    hh=x.hReg?`${hsChip(h.k)}<div class="kpis cmpk">${kp('Hojas/mueble esperadas',h.esp!=null?nfmt(h.esp):'—')}${kp('Hojas/mueble reales',nfmt(h.real))}${kp('Diferencia',sgn(h.difM),h.difM>hsTol?'pos':h.difM<-hsTol?'neg':'')}</div>
      ${h.esp!=null?`<div class="line">• Total OP: ${nfmt(h.esp*h.mu)} esperadas → ${nfmt(h.real*h.mu)} reales</div>`:''}${h.com?`<div class="line">• Comentario: ${esc(h.com)}</div>`:''}
      ${h.r.rev?'<div class="line c-ok">• ✓ Marcada como corregida</div>':''}<div class="line mut">• Capturado ${dmy(h.r.ts)}</div><a href="#" class="cmplk" data-cmph="${esc(x.op)}">Ver en Hojas single → Tablero</a>`
      :`<span class="chip st st-pend">Pendiente</span><p class="mut" style="margin:8px 0 0">Programada (${nfmt(h.esp||0)} hojas por mueble, ${nfmt(h.mu)} muebles) pero todavía no se captura el real.</p>`}
  return`<div class="card"><div class="head"><h2 style="margin:0">${esc(x.op)} · ${esc(x.modelo)}</h2><span class="mut">${[x.area?AREA_TXT[x.area]:'',x.fecha?'Programa '+dmyISO(x.fecha):'',(m=>m?nfmt(m)+(m===1?' mueble':' muebles'):'')(x.h&&x.h.mu?x.h.mu:(x.c&&x.c.r.cant)||0)].filter(Boolean).join(' · ')}</span></div></div>
    <div class="cmp2"><div class="card"><h2>Cartón</h2>${cc}</div><div class="card"><h2>Hojas single</h2>${hh}</div></div>`}

// Tabla de varias OP (búsqueda por modelo o lista general).
function cmpTabla(L,titulo,sub){
  return`<div class="card"><div class="head"><h2 style="margin:0">${titulo}</h2><span class="mut">${sub||''}</span></div>
    <div class="scroll"><table class="tc"><thead><tr><th>OP / Modelo</th><th>Programa</th><th>Cartón</th><th class="n">Dif. m²</th><th>Hojas single</th><th class="n">Dif. hojas/mueble</th></tr></thead><tbody>${
    L.map(x=>`<tr class="${x.cDif||x.hDif?'r-cambcons':x.c||x.hReg?'r-ok':'r-pend'}"><td><a href="#" data-cmpop="${esc(x.op)}"><b>${esc(x.modelo)}</b></a><br><span class="mut">${esc(x.op)}</span></td><td>${x.fecha?dmyISO(x.fecha):'—'}</td>
      <td>${cmpCelC(x)}</td><td class="n">${cmpDifC(x)}</td><td>${cmpCelH(x)}</td><td class="n">${cmpDifH(x)}</td></tr>`).join('')}</tbody></table></div></div>`}

let cmpLim=50;
function cmpVista(){
  const q=$('#cmpq').value.trim().toUpperCase(),soloDif=$('#cmpdif').checked,sinCor=$('#cmpcor').checked;
  let D=cmpDatos().filter(x=>x.c||x.hReg);                       // solo OP con algún consumo registrado
  if(soloDif)D=D.filter(x=>x.cDif||x.hDif);
  if(sinCor)D=D.filter(x=>!x.corregida);
  const out=$('#cmpres');
  if(!q){const L=D.sort((a,b)=>b.ult-a.ult);
    out.innerHTML=L.length?cmpTabla(L.slice(0,cmpLim),'Registros más recientes',`${L.length} OP con consumo registrado${soloDif?' y diferencia':''} · ${L.filter(x=>x.c&&x.hReg).length} con los dos materiales`)+(L.length>cmpLim?`<p><button class="btn ghost sm" id="cmpmas" type="button">Mostrar más (${L.length-cmpLim})</button></p>`:''):
      `<div class="card"><p class="mut" style="margin:0">${soloDif?'No hay OP con diferencia.':'Todavía no hay consumos registrados.'}</p></div>`;return}
  const exacta=cmpDatos().find(x=>x.op.toUpperCase()===q);
  if(exacta){out.innerHTML=cmpTarjetas(exacta);return}
  const L=D.filter(x=>x.op.toUpperCase().includes(q)||x.modelo.toUpperCase().includes(q)||modeloPrincipal(x.modelo)===q).sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||a.op.localeCompare(b.op));
  if(L.length===1){out.innerHTML=cmpTarjetas(L[0]);return}
  if(!L.length){out.innerHTML=`<div class="card"><p class="mut" style="margin:0">Ninguna OP o modelo con consumo registrado coincide con «${esc(q)}»${soloDif?' (con diferencia)':''}.</p></div>`;return}
  const mods=[...new Set(L.map(x=>x.modelo))],cd=L.filter(x=>x.cDif).length,hd=L.filter(x=>x.hDif).length;
  out.innerHTML=cmpTabla(L,`Búsqueda «${esc(q)}» · ${L.length} OP`,`${mods.length} modelo(s) · cartón con diferencia: ${cd} · hojas con diferencia: ${hd}`)+`<p class="mut">Da clic en un modelo para ver la OP con detalle.</p>`;
}
async function compAbrir(){stat('Cargando…');try{await Promise.all([reload(),hsCargarDatos(),hsLeerTol()]);stat('')}catch(x){dbErr(x,'Comparativo')}cmpLim=50;cmpVista()}
$('#cmpq').oninput=()=>{cmpLim=50;cmpVista()};
$('#cmpdif').onchange=()=>{cmpLim=50;cmpVista()};
$('#cmpcor').onchange=()=>{cmpLim=50;cmpVista()};
$('#cmpclr').onclick=()=>{$('#cmpq').value='';cmpLim=50;cmpVista();$('#cmpq').focus()};
$('#cmpres').addEventListener('click',e=>{const a=e.target.closest('[data-cmpop],[data-cmpc],[data-cmph],#cmpmas');if(!a)return;e.preventDefault();
  if(a.id==='cmpmas'){cmpLim+=50;cmpVista();return}
  if(a.dataset.cmpop){$('#cmpq').value=a.dataset.cmpop;cmpVista();window.scrollTo(0,0);return}
  if(a.dataset.cmpc){FSEL.forEach(x=>$(x).value='');$('#fq').value=a.dataset.cmpc;tab(2);return}
  if(a.dataset.cmph){HSF.forEach(x=>$(x).value='');$('#hfq').value=a.dataset.cmph;verModulo('hojas');hsAbrir('tab')}});
