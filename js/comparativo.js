// Módulo COMPARATIVO DE CONSUMOS (solo Administración): cartón y hojas single de una OP o un modelo, lado a lado.
// Solo LEE lo que ya calculan Cartón (reports, est) y Hojas single (hsDatos); nunca suma ni mezcla m² con hojas.
// Se carga después de hojas.js y antes de app.js.

// Una fila por OP con lo de cada material. Cartón: último registro de la OP (si hay varios, se indica).
function cmpDatos(){
  const C={};vis().filter(r=>r.kind==='op').sort((a,b)=>a.ts-b.ts).forEach(r=>{const o=C[r.op]||(C[r.op]={n:0});o.n++;o.r=r});
  const H={};hsDatos().forEach(x=>H[x.op]=x);
  return[...new Set([...Object.keys(C),...Object.keys(H)])].map(op=>{const c=C[op],h=H[op],r=c&&c.r;
    const e=r?est(r):null,cDif=!!e&&e.cls==='bad'&&!esExcep(r),hReg=!!(h&&h.r),hDif=!!h&&(h.k==='mas'||h.k==='menos');
    // «Corregida»: cada material que necesitaba corrección ya tiene la marca (Cartón: Corregido · Hojas: Corregido).
    const cNec=!!r&&porCorregir(r),cOk=cNec&&!!r.corr,hNec=!!h&&hsPorCorregir(h),hOk=hNec&&!!h.r.rev,corregida=(cNec||hNec)&&(!cNec||cOk)&&(!hNec||hOk);
    return{cOk,hOk,corregida,op,modelo:(r&&r.modelo)||(h&&h.modelo)||'',fecha:(h&&h.fecha)||(r&&r.venc)||'',area:h&&h.area||'',c:r?{r,e,n:c.n}:null,h:h||null,hReg,cDif,hDif,
      ult:Math.max(r?r.ts:0,hReg?h.r.ts:0)}});
}
const cmpCelC=x=>x.c?chipE(x.c.e,(EST[x.c.e.k]||{}).s||x.c.e.t)+(x.cOk?' <span class="c-ok" title="Corregido">✓</span>':''):'<span class="chip st st-pend">Sin registro</span>';
const cmpCelH=x=>x.hReg?hsChip(x.h.k)+(x.hOk?' <span class="c-ok" title="Corregido">✓</span>':''):x.h?'<span class="chip st st-pend">Pendiente</span>':'<span class="chip st st-pend">Sin registro</span>';
const cmpDifC=x=>x.c?`<span class="${x.c.r.R-x.c.r.E>0?'pos':x.c.r.R-x.c.r.E<0?'neg':''}">${sgm(x.c.r.R-x.c.r.E)}</span>`:'—';
const cmpDifH=x=>x.hReg&&x.h.difM!=null?`<span class="${x.h.difM>hsTol?'pos':x.h.difM<-hsTol?'neg':''}">${sgn(x.h.difM)}</span>`:'—';

// Tarjetas de una OP: cartón | hojas single.
function cmpTarjetas(x){
  const kp=(t,v,c)=>`<div class="kpi"><span class="mut">${t}</span><b class="${c||''}">${v}</b></div>`;
  let cc='<p class="mut">Esta OP no tiene registro de cartón.</p>';
  if(x.c){const r=x.c.r,d=r.R-r.E;
    cc=`${chipE(x.c.e)}<div class="kpis cmpk">${kp('m² esperados',fmt(r.E))}${kp('m² reales',fmt(r.R))}${kp('Diferencia',`${sgm(d)} <span class="mut" style="font-size:13px">(${pct(r.R,r.E)})</span>`,d>0?'pos':d<0?'neg':'')}</div>
    <div class="line">• Cartón: ${esc(cartP(r))}${cartU(r)!==cartP(r)?` → usado ${esc(cartU(r))}`:' (programado y usado)'}</div><div class="line">• Cajas: ${r.ce||0} → ${r.cr||0}</div>
    ${x.c.n>1?`<div class="line pos">• La OP tiene ${x.c.n} registros de cartón (se muestra el último).</div>`:''}<div class="line mut">• Registrado ${dmy(r.ts)}</div>
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
