// Módulo HOJAS SINGLE (solo Administración): programa del ERP, PDF de producción y, en etapas siguientes,
// captura de reales, Tablero, Análisis y Modelos. No toca nada de Cartón ni de la vista de Planta.
// Se carga después de carton.js (usa $, esc, DB, SBC, NUBE, quien, stat, dbErr…) y antes de app.js.

/* ==== REGLAS DEL MÓDULO ==== */
const HS={
  kgHoja:0.25,                                   // peso de una hoja single (kg): hojas = kg ÷ 0.25
  areas:{'ENS MUEBLE':'MUEBLES','ENS LIBRER':'LIBREROS'},   // «Cód. conexión ruta» → área; las demás se ignoran
  productos:['10207002'],                        // HOJA DE SINGLE FACE 100 X 75CM; otros componentes se ignoran
  titulo:{MUEBLES:'ENSAMBLE MUEBLES',LIBREROS:'ENSAMBLE LIBREROS'},
  orden:['MUEBLES','LIBREROS']
};
const AREA_TXT={MUEBLES:'Muebles',LIBREROS:'Libreros'};
const entero=x=>Math.abs(x-Math.round(x))<1e-6;
const nfmt=x=>entero(x)?String(Math.round(x)):x.toFixed(2);
const dmyISO=s=>{const m=String(s||'').match(/^(\d{4})-(\d\d)-(\d\d)/);return m?m[3]+'/'+m[2]+'/'+m[1]:'—'};

/* ==== CAPA DE DATOS DE HOJAS SINGLE ====
   Nube: tablas hs_programa y hs_registros (supabase/hojas-single.sql). Local: navegador (modo sin nube).
   Programa: {op, modelo, area, fecha (yyyy-mm-dd), kgPor, kgEsp, muebles, hojasMueble, estadoERP, producto, act, por} */
const HDB=(()=>{
  const sinTabla=e=>/hs_programa|hs_registros|42P01|PGRST205|schema cache|does not exist/i.test((e&&(e.message+' '+e.code))||'');
  const err=e=>{const x=new Error(sinTabla(e)?'Faltan las tablas de Hojas single en Supabase. Corre el script supabase/hojas-single.sql (etapa 3).':(e&&e.message)||String(e));x.code=sinTabla(e)?'sintabla':e&&e.code;return x};
  const run=async q=>{const {data,error}=await q;if(error)throw err(error);return data};
  const todo=async mk=>{let out=[],i=0;for(;;){const d=await run(mk().range(i,i+999));out=out.concat(d||[]);if(!d||d.length<1000)return out;i+=1000}};
  if(NUBE)return{
    async listPrograma(){return(await todo(()=>SBC.from('hs_programa').select('op,modelo,area,fecha_venc,data,updated_at,updated_by').order('op')))
      .map(w=>({...w.data,op:w.op,modelo:w.modelo,area:w.area,fecha:w.fecha_venc||'',act:w.updated_at,por:w.updated_by||''}))},
    async upsertPrograma(L){const por=quien(),now=new Date().toISOString();
      const rows=L.map(p=>({op:p.op,modelo:p.modelo,area:p.area,fecha_venc:p.fecha||null,updated_at:now,updated_by:por,
        data:{kgPor:p.kgPor,kgEsp:p.kgEsp,muebles:p.muebles,hojasMueble:p.hojasMueble,estadoERP:p.estadoERP,producto:p.producto}}));
      for(let i=0;i<rows.length;i+=500)await run(SBC.from('hs_programa').upsert(rows.slice(i,i+500),{onConflict:'op'}))},
    async listRegistros(){return(await todo(()=>SBC.from('hs_registros').select('id,op,ts,data,version,capturado_por').is('deleted_at',null).order('ts',{ascending:false})))
      .map(w=>({...w.data,id:w.id,op:w.op,ts:w.ts,version:w.version,por:w.capturado_por||''}))},
    // Guarda un registro: nuevo (sin id) o corrección (con id y versión; si otro lo cambió antes, avisa).
    async saveRegistro(r){const data={...r};['id','op','ts','version','por'].forEach(k=>delete data[k]);
      if(r.id==null)return run(SBC.from('hs_registros').insert({op:r.op,ts:r.ts,data,capturado_por:quien()}).select('id').single());
      const v=Number(r.version)||1,d=await run(SBC.from('hs_registros').update({data,version:v+1}).eq('id',r.id).eq('version',v).select('id'));
      if(!d||!d.length)throw new Error('Otro usuario modificó la OP '+r.op+' mientras capturabas. Recarga y vuelve a intentar.')},
    async deleteRegistro(r){const v=Number(r.version)||1,d=await run(SBC.from('hs_registros').update({deleted_at:new Date().toISOString(),version:v+1}).eq('id',r.id).eq('version',v).select('id'));
      if(!d||!d.length)throw new Error('Otro usuario modificó la OP '+r.op+'. Recarga y vuelve a intentar.')}
  };
  const get=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};
  const put=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){throw new Error('No se pudo escribir en el almacenamiento del navegador (¿lleno?).')}};
  return{
    async listPrograma(){return Object.values(get('hs_programa',{}))},
    async upsertPrograma(L){const c=get('hs_programa',{}),por=quien(),now=new Date().toISOString();L.forEach(p=>c[p.op]={...p,act:now,por});put('hs_programa',c)},
    async listRegistros(){return get('hs_registros',[])},
    async saveRegistro(r){const a=get('hs_registros',[]);if(r.id==null){let i=Date.now();while(a.some(x=>x.id===i))i++;a.unshift({...r,id:i,por:quien()})}
      else{const k=a.findIndex(x=>x.id===r.id);if(k<0)throw new Error('El registro de '+r.op+' ya no existe.');a[k]={...a[k],...r}}put('hs_registros',a)},
    async deleteRegistro(r){put('hs_registros',get('hs_registros',[]).filter(x=>x.id!==r.id))}
  };
})();

/* ==== LECTURA DEL EXCEL DEL ERP («Líneas comp. ped. prod.») ====
   Busca las columnas por nombre (sin importar orden, mayúsculas ni acentos). Por OP:
     hojas por mueble = Cantidad por ÷ 0.25     muebles = Cantidad esperada ÷ Cantidad por */
const normH=s=>String(s==null?'':s).normalize('NFD').replace(/[̀-ͯ]/g,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const HS_COLS={op:['nordenproduccion','ordenproduccion','noorden','op'],modelo:['codprocedencia','procedencia'],ruta:['codconexionruta'],
  producto:['nproducto','noproducto','producto'],desc:['descripcion'],fecha:['fechavencimiento','fechavenc'],
  kgPor:['cantidadpor'],kgEsp:['cantidadesperada','compesperados'],estado:['estado']};
function leerProgramaHS(rows){
  const out={ok:[],leidas:rows.length,otrasAreas:{},otrosProd:0,avisos:[],faltan:[]};
  if(!rows.length){out.faltan=['(el archivo no tiene renglones)'];return out}
  const H=Object.keys(rows[0]),col={};
  Object.entries(HS_COLS).forEach(([k,al])=>{col[k]=H.find(h=>al.includes(normH(h)))||H.find(h=>al.some(a=>normH(h).startsWith(a)))});
  out.faltan=['op','modelo','ruta','fecha','kgPor','kgEsp'].filter(k=>!col[k]).map(k=>({op:'Nº orden producción',modelo:'Cód. procedencia',ruta:'Cód. conexión ruta',fecha:'Fecha vencimiento',kgPor:'Cantidad por',kgEsp:'Cantidad esperada'}[k]));
  if(out.faltan.length)return out;
  const by={};
  rows.forEach(r=>{
    const op=String(r[col.op]||'').trim().toUpperCase();if(!op)return;
    const ruta=String(r[col.ruta]||'').trim().toUpperCase(),area=HS.areas[ruta];
    if(!area){const k=ruta||'(sin ruta)';out.otrasAreas[k]=(out.otrasAreas[k]||0)+1;return}
    const prod=col.producto?codigo(r[col.producto]):'',desc=col.desc?String(r[col.desc]||''):'';
    if(prod?!HS.productos.includes(prod):!/single/i.test(desc)){out.otrosProd++;return}
    const kgPor=num(r[col.kgPor]),kgEsp=num(r[col.kgEsp]),fecha=r[col.fecha]===''?'':isoDate(r[col.fecha]);
    const x=by[op];
    if(x){x.kgPor+=kgPor;x.kgEsp+=kgEsp;x.dup=(x.dup||1)+1;return}
    by[op]={op,modelo:String(r[col.modelo]||'').trim(),area,fecha,kgPor,kgEsp,producto:prod,estadoERP:col.estado?String(r[col.estado]||'').trim():''};
  });
  Object.values(by).forEach(p=>{
    p.hojasMueble=p.kgPor/HS.kgHoja;p.muebles=p.kgPor>0?p.kgEsp/p.kgPor:0;
    if(p.dup)out.avisos.push(`${p.op} viene en ${p.dup} renglones: se sumaron.`);
    if(!(p.kgPor>0))out.avisos.push(`${p.op} (${p.modelo}): «Cantidad por» en 0 — no se puede calcular hojas por mueble. Revisar en Dynamics.`);
    else{if(!entero(p.hojasMueble))out.avisos.push(`${p.op} (${p.modelo}): da ${p.hojasMueble.toFixed(2)} hojas por mueble (${p.kgPor} kg ÷ 0.25). Revisar en Dynamics.`);
      if(!entero(p.muebles))out.avisos.push(`${p.op} (${p.modelo}): da ${p.muebles.toFixed(2)} muebles (${p.kgEsp} ÷ ${p.kgPor}). Revisar en Dynamics.`)}
    if(!p.fecha)out.avisos.push(`${p.op} (${p.modelo}): sin fecha de vencimiento.`);
    delete p.dup;out.ok.push(p);
  });
  return out;
}

/* ==== ESTADO Y PANTALLA «PROGRAMA» ==== */
let hsProg=[],hsReg=[],hsPend=null,hsFecha='';
const hsCambio=(a,b)=>a.modelo!==b.modelo||a.area!==b.area||a.fecha!==b.fecha||Math.abs(a.kgPor-b.kgPor)>1e-9||Math.abs(a.kgEsp-b.kgEsp)>1e-9;
async function hsCargarDatos(){[hsProg,hsReg]=await Promise.all([HDB.listPrograma(),HDB.listRegistros()])}
const hsMsg=(h,bad)=>{const e=$('#hsmsg');e.innerHTML=h;e.style.color=bad?'var(--bad)':''};

async function hsSubirExcel(f){
  hsMsg('Leyendo archivo…');
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{cellDates:true});
    const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
    const R=leerProgramaHS(rows);
    if(R.faltan.length){hsMsg('⚠ Este archivo no parece el reporte «Líneas comp. ped. prod.». Faltan columnas: <b>'+R.faltan.map(esc).join(', ')+'</b>.',true);return}
    await hsCargarDatos();
    const ya=Object.fromEntries(hsProg.map(p=>[p.op,p])),conReal=new Set(hsReg.map(r=>r.op));
    const nuevas=[],act=[],igual=[],retenidas=[];
    R.ok.forEach(p=>{const x=ya[p.op];if(!x)nuevas.push(p);else if(!hsCambio(p,x))igual.push(p);else if(conReal.has(p.op))retenidas.push(p);else act.push(p)});
    const subir=[...nuevas,...act];if(subir.length)await HDB.upsertPrograma(subir);
    await hsCargarDatos();
    const cnt=a=>HS.orden.map(k=>`${a.filter(p=>p.area===k).length} ${AREA_TXT[k]}`).join(', ');
    const otras=Object.entries(R.otrasAreas);
    let h=`<b>✓ Programa cargado.</b> ${R.leidas} renglones leídos · <b>${R.ok.length} OP</b> de hojas single (${cnt(R.ok)}).<br>`+
      `${nuevas.length} nuevas · ${act.length} actualizadas · ${igual.length} sin cambios.`;
    if(otras.length)h+=`<br><span class="mut">Otras áreas ignoradas: ${otras.map(([k,n])=>`${esc(k)} (${n})`).join(', ')}.</span>`;
    if(R.otrosProd)h+=`<br><span class="mut">${R.otrosProd} renglón(es) de otros componentes ignorados.</span>`;
    if(R.avisos.length)h+=`<div class="al st-cons" style="display:block;margin-top:8px"><b>⚠ Revisar (${R.avisos.length}):</b><ul style="margin:4px 0 0 18px;padding:0">${R.avisos.map(a=>`<li>${esc(a)}</li>`).join('')}</ul></div>`;
    hsPend=retenidas.length?retenidas:null;
    if(retenidas.length)h+=`<div class="al st-camb" style="display:block;margin-top:8px"><b>${retenidas.length} OP cambiaron en el ERP pero ya tienen hojas reales capturadas</b>, así que no se actualizaron: ${retenidas.map(p=>esc(p.op)).join(', ')}.<br><button class="btn ghost sm" id="hsforzar" type="button" style="margin-top:6px">Actualizar también estas OP</button></div>`;
    hsMsg(h);
    const fs=[...new Set(R.ok.map(p=>p.fecha).filter(Boolean))].sort();if(fs.length&&!fs.includes(hsFecha))hsFecha=hsFechaDefault(fs);
    hsProgramaView(true);
  }catch(x){hsMsg('⚠ '+esc(x.message||x),true)}
}
// Fecha sugerida: hoy si existe; si no, la siguiente; si no, la más reciente.
function hsFechaDefault(fs){const hoy=ymd(new Date());return fs.includes(hoy)?hoy:(fs.find(f=>f>hoy)||fs[fs.length-1]||'')}

function hsProgramaView(keepMsg){
  const fs=[...new Set(hsProg.map(p=>p.fecha).filter(Boolean))].sort().reverse();
  if(!fs.includes(hsFecha))hsFecha=hsFechaDefault([...fs].reverse());
  const sel=$('#hsfecha');sel.innerHTML=fs.length?fs.map(f=>`<option value="${f}"${f===hsFecha?' selected':''}>${dmyISO(f)}</option>`).join(''):'<option value="">— Sin programa cargado —</option>';
  const D=hsDelDia(hsFecha),c=k=>D.filter(p=>p.area===k).length,B=hsBusca($('#hsq').value),L=B||D;
  $('#hsinfo').innerHTML=fs.length?`${HS.orden.map(k=>`<b>${AREA_TXT[k]}:</b> ${c(k)} OP`).join(' · ')}`+(B?` · <b style="color:var(--acc)">Búsqueda: ${B.length} resultado(s) en todas las fechas</b>`:''):'Carga primero el Excel del ERP.';
  $('#hspdf').disabled=!D.length;
  const conReal=new Set(hsReg.map(r=>r.op));
  $('#hstabla').innerHTML=!L.length&&B?'<p class="mut">Ninguna OP o modelo coincide con la búsqueda.</p>':L.length?`<div class="scroll"><table class="tc"><thead><tr>${B?'<th>Programa</th>':''}<th>Área</th><th>OP</th><th>Modelo</th><th class="n">Muebles</th><th class="n">Hojas por mueble</th><th class="n">Hojas totales</th><th>Real</th></tr></thead><tbody>`+
    L.map(p=>{const raro=!(p.kgPor>0)||!entero(p.hojasMueble)||!entero(p.muebles);
      return`<tr${raro?' class="fx"':''}>${B?`<td>${dmyISO(p.fecha)}</td>`:''}<td>${AREA_TXT[p.area]}</td><td>${esc(p.op)}</td><td>${esc(p.modelo)}</td><td class="n">${nfmt(p.muebles)}</td><td class="n">${nfmt(p.hojasMueble)}</td><td class="n">${nfmt(p.muebles*p.hojasMueble)}</td><td>${conReal.has(p.op)?'<span class="chip ok">Capturado</span>':'<span class="mut">Pendiente</span>'}</td></tr>`}).join('')+
    `</tbody></table></div>`+(L.some(p=>!(p.kgPor>0)||!entero(p.hojasMueble)||!entero(p.muebles))?`<p class="mut" style="margin:6px 0 0">Renglones en rojo: programación por revisar en Dynamics.</p>`:''):'';
  if(!keepMsg&&!hsProg.length)hsMsg('');
}
// Búsqueda por OP o modelo: busca en TODO el programa (cualquier fecha y área), sin importar la fecha elegida.
const hsBusca=q=>{q=String(q||'').trim().toUpperCase();return q?hsProg.filter(p=>p.op.toUpperCase().includes(q)||String(p.modelo).toUpperCase().includes(q))
  .sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||a.op.localeCompare(b.op)):null};
const hsDelDia=f=>hsProg.filter(p=>p.fecha===f).sort((a,b)=>HS.orden.indexOf(a.area)-HS.orden.indexOf(b.area)||a.op.localeCompare(b.op));

/* ==== PDF DE PRODUCCIÓN ====  Un archivo, una página (o más si no cabe) por área: Muebles y luego Libreros.
   Formato del registro en papel: el operador llena a mano «Hojas realmente utilizadas por mueble». Sin logo. */
let jsPdfListo=null;
const cargarJs=src=>new Promise((ok,ko)=>{const s=document.createElement('script');s.src=src;s.onload=ok;s.onerror=()=>ko(new Error('No se pudo cargar '+src));document.head.appendChild(s)});
const pdfLib=()=>jsPdfListo||(jsPdfListo=cargarJs('vendor/jspdf.umd.min.js').then(()=>cargarJs('vendor/jspdf.plugin.autotable.min.js')));
async function hsGenerarPDF(){
  const f=hsFecha,L=hsDelDia(f);if(!L.length)return;
  $('#hspdf').disabled=true;$('#hspdfmsg').textContent='Generando PDF…';
  try{
    await pdfLib();
    const doc=new window.jspdf.jsPDF({unit:'mm',format:'a4',orientation:'portrait'});
    const AZUL=[31,78,121],AZULC=[217,225,242],RAYA=[221,235,247],AMAR=[255,242,204],LINEA=[160,170,180],FILAS=44;
    HS.orden.forEach((a,i)=>{
      if(i)doc.addPage();
      const P=L.filter(p=>p.area===a);
      const body=P.map(p=>[p.op,p.modelo,nfmt(p.muebles),p.hojasMueble.toFixed(2),'']);
      const vac=Math.max(P.length>FILAS-4?6:0,FILAS-P.length);for(let k=0;k<vac;k++)body.push(['','','','','']);
      doc.autoTable({startY:12,margin:{left:14,right:14,top:12,bottom:10},theme:'grid',
        head:[[{content:`Registro y control de hoja de single - ${HS.titulo[a]}\n${dmyISO(f)}`,colSpan:5,styles:{fillColor:AZUL,textColor:255,fontStyle:'bold',fontSize:12,halign:'center',cellPadding:2}}],
              ['OP','Modelo','Muebles programados','Hojas utilizadas por mueble (pzas)','Hojas realmente utilizadas por mueble (pzas)']],
        body,showHead:'everyPage',
        styles:{fontSize:8.5,halign:'center',valign:'middle',cellPadding:0.9,lineColor:LINEA,lineWidth:0.15,textColor:20,minCellHeight:5.2},
        headStyles:{fillColor:AZULC,textColor:20,fontStyle:'bold',fontSize:8.5,minCellHeight:12},
        columnStyles:{0:{cellWidth:52},1:{cellWidth:28}},
        didParseCell:d=>{if(d.section!=='body')return;if(d.column.index===4)d.cell.styles.fillColor=AMAR;else if(d.row.index%2===0)d.cell.styles.fillColor=RAYA}});
      if(!P.length){doc.setFontSize(9);doc.setTextColor(120);doc.text(`Sin OP de ${AREA_TXT[a].toLowerCase()} para esta fecha.`,14,doc.internal.pageSize.getHeight()-5)}
    });
    doc.save(`Hojas single ${dmyISO(f).replace(/\//g,'-')}.pdf`);
    const sin=HS.orden.filter(a=>!L.some(p=>p.area===a));
    $('#hspdfmsg').textContent='✓ PDF generado'+(sin.length?` (la página de ${sin.map(a=>AREA_TXT[a]).join(' y ')} va vacía: no hay OP de esa área en esta fecha)`:'')+'.';
  }catch(x){$('#hspdfmsg').textContent='⚠ '+(x.message||x)}
  finally{$('#hspdf').disabled=false}
}

/* ==== CAPTURA DE REALES (Administración) ====
   Misma forma que el PDF: eliges fecha y área, escribes las «Hojas realmente utilizadas por mueble» y cada renglón se pinta
   al momento. Nada se guarda hasta «Guardar». Las OP sin capturar quedan Pendientes y siguen apareciendo en fechas
   posteriores (sección «Pendientes de fechas anteriores») hasta que se registren. Lo ya capturado se puede corregir;
   si borras el número de una OP capturada y guardas, el registro se elimina (vuelve a Pendiente). */
let hsTol=0;                                     // tolerancia en hojas por mueble (etapa 6: configurable)
let hcArea='MUEBLES',hcEdit={},hcExtra=[],hcComV=PREF.get('hs_com')==='1';
const HC_EST={ok:{k:'ok',t:'Correcto'},dif:{k:'cambcons',t:'Diferencia'},pend:{k:'pend',t:'Pendiente'},sinprog:{k:'sinprog',t:'Sin programar'}};
const hsRegBy=()=>{const m={};[...hsReg].sort((a,b)=>a.ts-b.ts).forEach(r=>m[r.op]=r);return m};
const hcNum=v=>{const t=String(v==null?'':v).trim().replace(',','.');return t===''?null:(/^\d+(\.\d+)?$/.test(t)?parseFloat(t):NaN)};
function hsEstado(esp,real){if(real==null)return HC_EST.pend;if(esp==null)return HC_EST.sinprog;return Math.abs(real-esp)<=hsTol+1e-9?HC_EST.ok:HC_EST.dif}
// Valor que se ve en el renglón: lo editado (sin guardar) o lo guardado.
const hcVal=(op,k)=>{const e=hcEdit[op];if(e&&k in e)return e[k];const r=hsRegBy()[op];return r?(k==='real'?String(r.real):(r.com||'')):''};
function hcFilas(){
  const reg=hsRegBy(),f=hsFecha,a=hcArea;
  const dia=hsProg.filter(p=>p.fecha===f&&p.area===a).sort((x,y)=>x.op.localeCompare(y.op));
  const enDia=new Set(dia.map(p=>p.op));
  const pend=hsProg.filter(p=>p.area===a&&p.fecha&&p.fecha<f&&!reg[p.op]&&!enDia.has(p.op)).sort((x,y)=>x.fecha.localeCompare(y.fecha)||x.op.localeCompare(y.op));
  // capturadas sin programa (OP agregadas a mano) de esta fecha/área
  const sinp=Object.values(reg).filter(r=>!hsProg.some(p=>p.op===r.op)&&r.prog&&r.prog.area===a&&r.prog.fecha===f);
  return{dia,pend,sinp};
}
function hcRow(p,o){o=o||{};const op=p.op,esp=p.kgPor>0?p.hojasMueble:null,rv=hcVal(op,'real'),real=hcNum(rv),e=isNaN(real)?null:hsEstado(esp,real);
  const dif=real!=null&&!isNaN(real)&&esp!=null?real-esp:null,ed=hcEdit[op]&&Object.keys(hcEdit[op]).length;
  return`<tr class="r-${e?e.k:'err'}" data-op="${esc(op)}"><td>${esc(op)}${o.fecha?`<br><span class="mut">Programa ${dmyISO(p.fecha)}${o.area?' · '+AREA_TXT[p.area]:''}</span>`:''}</td><td>${esc(p.modelo||'')}</td>
    <td class="n">${p.muebles!=null&&p.muebles!==''?nfmt(+p.muebles):'—'}</td><td class="n">${esp!=null?nfmt(esp):'—'}</td>
    <td><input class="hcreal" data-op="${esc(op)}" inputmode="decimal" autocomplete="off" value="${esc(rv)}" style="width:80px${isNaN(real)?';border-color:var(--bad)':''}"></td>
    <td class="n hcdif"><span class="${dif==null?'':Math.abs(dif)<=hsTol+1e-9?'c-ok':'pos'}" style="font-weight:600">${dif==null?'—':(dif>0?'+':'')+nfmt(dif)}</span>${!e?' <span class="chip err">Inválido</span>':''}${ed?' <span class="mut" title="Sin guardar">●</span>':''}${!hcComV&&hcVal(op,'com').trim()?` <span title="${esc(hcVal(op,'com'))}">💬</span>`:''}</td>
    <td class="hcest ccom">${e?`<span class="chip st st-${e.k}">${e.t}</span>`:'<span class="chip err">Número inválido</span>'}</td>
    <td class="ccom"><input class="hccom" data-op="${esc(op)}" autocomplete="off" value="${esc(hcVal(op,'com'))}" placeholder="Opcional" style="min-width:120px"></td></tr>`}
const HC_HEAD='<thead><tr><th>OP</th><th>Modelo</th><th class="n">Muebles</th><th class="n">Hojas por mueble</th><th>Reales por mueble</th><th class="n">Diferencia</th><th class="ccom">Estado</th><th class="ccom">Comentario</th></tr></thead>';
function hsCapturaView(){
  const fs=[...new Set(hsProg.map(p=>p.fecha).filter(Boolean))].sort().reverse();
  if(!fs.includes(hsFecha))hsFecha=hsFechaDefault([...fs].reverse());
  $('#hcfecha').innerHTML=fs.length?fs.map(f=>`<option value="${f}"${f===hsFecha?' selected':''}>${dmyISO(f)}</option>`).join(''):'<option value="">— Sin programa cargado —</option>';
  $('#hcarea').value=hcArea;$('#hccomv').checked=hcComV;
  const B=hsBusca($('#hcq').value);$('#hcfecha').disabled=$('#hcarea').disabled=!!B;
  if(B){$('#hcinfo').innerHTML=`<b style="color:var(--acc)">Búsqueda: ${B.length} resultado(s)</b> en todas las fechas y áreas. Borra la búsqueda para volver a la fecha y área elegidas.`;
    $('#hctabla').innerHTML=B.length?`<div class="scroll"><table id="hctab" class="tc${hcComV?'':' nocom'}">${HC_HEAD}<tbody>${B.map(p=>hcRow(p,{fecha:1,area:1})).join('')}</tbody></table></div>`:'<p class="mut">Ninguna OP o modelo coincide con la búsqueda.</p>';return}
  const {dia,pend,sinp}=hcFilas(),reg=hsRegBy(),todas=[...dia,...pend];
  const capt=todas.filter(p=>reg[p.op]).length,dif=todas.filter(p=>reg[p.op]&&p.kgPor>0&&Math.abs(reg[p.op].real-p.hojasMueble)>hsTol+1e-9).length;
  $('#hcinfo').innerHTML=fs.length?`<b>${dia.length}</b> OP de ${AREA_TXT[hcArea].toLowerCase()} en esta fecha · ${dia.filter(p=>reg[p.op]).length} capturadas · ${dia.filter(p=>!reg[p.op]).length} pendientes`+
    (dif?` · <b style="color:var(--bad)">${dif} con diferencia</b>`:'')+(pend.length?` · <b style="color:var(--warn)">${pend.length} pendientes de fechas anteriores</b>`:''):'Carga primero el programa en «Programa».';
  const head=HC_HEAD;
  let h=dia.map(p=>hcRow(p)).join('')+sinp.map(r=>hcRow({op:r.op,modelo:r.prog.modelo,muebles:r.prog.muebles,kgPor:0})).join('');
  if(pend.length)h+=`<tr><td colspan="8" style="background:var(--warnbg);color:var(--warn);font-weight:600">Pendientes de fechas anteriores (${pend.length})</td></tr>`+pend.map(p=>hcRow(p,{fecha:1})).join('');
  h+=hcExtra.map((x,i)=>`<tr class="r-pend"><td colspan="8"><div class="row"><label>OP agregada a mano<input class="hcxop" data-i="${i}" value="${esc(x.op)}" placeholder="OP…" autocomplete="off"></label><label>Modelo<input class="hcxmod" data-i="${i}" value="${esc(x.modelo)}" autocomplete="off"></label><label>Muebles<input class="hcxmu" data-i="${i}" value="${esc(x.muebles)}" inputmode="numeric"></label><label>Reales por mueble<input class="hcxreal" data-i="${i}" value="${esc(x.real)}" inputmode="decimal"></label><button class="btn ghost sm" data-hcxdel="${i}" type="button">Quitar</button></div></td></tr>`).join('');
  $('#hctabla').innerHTML=dia.length||pend.length||sinp.length||hcExtra.length?`<div class="scroll"><table id="hctab" class="tc${hcComV?'':' nocom'}">${head}<tbody>${h}</tbody></table></div>`:'<p class="mut">No hay OP de esta área para la fecha elegida.</p>';
}
const hcDirty=()=>Object.values(hcEdit).some(e=>Object.keys(e).length)||hcExtra.some(x=>x.op||x.real);
function hcSet(op,k,v){const r=hsRegBy()[op],g=r?(k==='real'?String(r.real):(r.com||'')):'';const e=hcEdit[op]||(hcEdit[op]={});if(v===g)delete e[k];else e[k]=v}
function hcRepinta(tr){const op=tr.dataset.op,p=hsProg.find(x=>x.op===op)||{op,kgPor:0,modelo:(hsRegBy()[op]||{prog:{}}).prog.modelo,muebles:(hsRegBy()[op]||{prog:{}}).prog.muebles};
  const pend=!!tr.querySelector('.mut')&&tr.cells[0].querySelector('.mut');const tmp=document.createElement('tbody');tmp.innerHTML=hcRow(p,{fecha:pend,area:pend});const n=tmp.firstElementChild;
  tr.className=n.className;tr.querySelector('.hcdif').innerHTML=n.querySelector('.hcdif').innerHTML;tr.querySelector('.hcest').innerHTML=n.querySelector('.hcest').innerHTML;
  tr.querySelector('.hcreal').style.borderColor=n.querySelector('.hcreal').style.borderColor}
const hcMsg=(h,bad)=>{const e=$('#hcmsg');e.innerHTML=h;e.style.color=bad?'var(--bad)':''};
async function hcGuardar(){
  const reg=hsRegBy(),nuevos=[],corr=[],borrar=[],malos=[];
  // OP agregadas a mano: si ya están en la tabla se pasan a ese renglón
  for(const x of hcExtra){const op=String(x.op||'').trim().toUpperCase();if(!op&&!String(x.real).trim())continue;
    if(!op){malos.push('falta la OP en un renglón agregado');continue}const v=hcNum(x.real);if(v==null||isNaN(v)){malos.push(op+': hojas reales inválidas');continue}
    const p=hsProg.find(q=>q.op===op);if(reg[op]||p){hcSet(op,'real',String(v));continue}
    nuevos.push({op,ts:Date.now(),real:v,com:'',prog:{modelo:String(x.modelo||'').trim(),area:hcArea,fecha:hsFecha,muebles:num(x.muebles)||'',hojasMueble:null,manual:true}})}
  Object.entries(hcEdit).forEach(([op,e])=>{if(!Object.keys(e).length)return;const r=reg[op],p=hsProg.find(q=>q.op===op);
    const rv='real' in e?e.real:(r?String(r.real):''),v=hcNum(rv),com=('com' in e?e.com:(r&&r.com)||'').trim();
    if(v!=null&&isNaN(v)){malos.push(op+': «'+rv+'» no es un número');return}
    if(v==null){if(r)borrar.push(r);return}
    const prog=p?{modelo:p.modelo,area:p.area,fecha:p.fecha,muebles:p.muebles,hojasMueble:p.hojasMueble}:(r&&r.prog)||{area:hcArea,fecha:hsFecha};
    if(!r)nuevos.push({op,ts:Date.now(),real:v,com,prog});else corr.push({...r,real:v,com,prog:r.prog||prog,corr:{por:quien(),ts:Date.now()}})});
  if(malos.length){hcMsg('⚠ Revisa antes de guardar: '+malos.map(esc).join(' · '),true);return}
  if(!nuevos.length&&!corr.length&&!borrar.length){hcMsg('No hay cambios por guardar.');return}
  if(borrar.length&&!confirm(`Vas a borrar el registro de ${borrar.length} OP (${borrar.map(r=>r.op).join(', ')}): volverán a Pendiente. ¿Continuar?`))return;
  $('#hcsave').disabled=true;hcMsg('Guardando…');let ok=0;
  try{for(const r of nuevos){await HDB.saveRegistro(r);ok++}for(const r of corr){await HDB.saveRegistro(r);ok++}for(const r of borrar){await HDB.deleteRegistro(r);ok++}
    hcEdit={};hcExtra=[];await hsCargarDatos();hsCapturaView();
    hcMsg(`✓ Guardado: ${nuevos.length} nuevo(s)`+(corr.length?`, ${corr.length} corregido(s)`:'')+(borrar.length?`, ${borrar.length} borrado(s)`:'')+'.')}
  catch(x){await hsCargarDatos().catch(()=>{});hsCapturaView();hcMsg('⚠ '+esc(x.message||x)+(ok?` (se alcanzaron a guardar ${ok}; revisa y vuelve a guardar lo que falte)`:''),true)}
  finally{$('#hcsave').disabled=false}
}
$('#hctabla').addEventListener('input',e=>{const t=e.target,tr=t.closest('tr');
  if(t.classList.contains('hcreal')){hcSet(t.dataset.op,'real',t.value);hcRepinta(tr)}
  else if(t.classList.contains('hccom')){hcSet(t.dataset.op,'com',t.value);hcRepinta(tr)}
  else{const i=t.dataset.i;if(i==null)return;const x=hcExtra[i],k=t.classList.contains('hcxop')?'op':t.classList.contains('hcxmod')?'modelo':t.classList.contains('hcxmu')?'muebles':'real';x[k]=t.value;
    if(k==='op'){const p=hsProg.find(q=>q.op===t.value.trim().toUpperCase());if(p){x.modelo=p.modelo;x.muebles=nfmt(p.muebles);tr.querySelector('.hcxmod').value=x.modelo;tr.querySelector('.hcxmu').value=x.muebles}}}
  hcMsg('')});
// Enter = bajar al siguiente renglón (para pasar el papel rápido)
$('#hctabla').addEventListener('keydown',e=>{if(e.key!=='Enter'||!e.target.classList.contains('hcreal'))return;e.preventDefault();
  const I=[...document.querySelectorAll('#hctabla .hcreal')],k=I.indexOf(e.target);if(I[k+1]){I[k+1].focus();I[k+1].select()}else $('#hcsave').focus()});
$('#hctabla').addEventListener('click',e=>{const i=e.target.dataset.hcxdel;if(i==null)return;hcExtra.splice(+i,1);hsCapturaView()});
$('#hcadd').onclick=()=>{hcExtra.push({op:'',modelo:'',muebles:'',real:''});hsCapturaView();const I=document.querySelectorAll('#hctabla .hcxop');if(I.length)I[I.length-1].focus()};
$('#hcsave').onclick=()=>hcGuardar();
$('#hcq').oninput=()=>hsCapturaView();   // los cambios sin guardar se conservan al buscar (van por OP)
$('#hsq').oninput=()=>hsProgramaView(true);
// Estado y comentarios ocultos por defecto (se recuerda en este equipo). Sin ellos, el color queda en la línea del renglón y en la
// diferencia (verde = correcto, rojo = diferencia); 💬 indica que la OP tiene comentario (pasa el mouse para leerlo).
$('#hccomv').onchange=e=>{hcComV=e.target.checked;PREF.set('hs_com',hcComV?'1':'');hsCapturaView()};
const hcCambiar=fn=>{if(hcDirty()&&!confirm('Tienes cambios sin guardar en la captura. ¿Descartarlos?'))return false;hcEdit={};hcExtra=[];hcMsg('');fn();hsCapturaView();return true};
$('#hcfecha').onchange=e=>{const v=e.target.value;if(!hcCambiar(()=>hsFecha=v))e.target.value=hsFecha};
$('#hcarea').onchange=e=>{const v=e.target.value;if(!hcCambiar(()=>hcArea=v))e.target.value=hcArea};
window.addEventListener('beforeunload',e=>{if(hcDirty()){e.preventDefault();e.returnValue=''}});

/* ==== TABLERO Y ANÁLISIS DE HOJAS SINGLE (etapa 6) ====
   Base de comparación: hojas por mueble (esperadas = Cantidad por ÷ 0.25 vs reales capturadas). Los totales de la OP
   = hojas por mueble × muebles programados. El periodo se filtra por FECHA DE PROGRAMA (Fecha vencimiento del ERP).
   Estados: Correcto (|real − esperado| ≤ tolerancia) · Diferencia · Pendiente (sin capturar) · Sin programar. */
const HS_ESTADOS=[{k:'ok',t:'Correcto',c:'st-ok'},{k:'mas',t:'De más',c:'st-cambcons'},{k:'menos',t:'De menos',c:'st-extra'},{k:'pend',t:'Pendiente',c:'st-pend'},{k:'sinprog',t:'Sin programar',c:'st-sinprog'}];
const HSE=Object.fromEntries(HS_ESTADOS.map(x=>[x.k,x]));
const hsChip=k=>`<span class="chip st ${HSE[k].c}">${HSE[k].t}</span>`;
function hsDatos(){const reg=hsRegBy(),P=Object.fromEntries(hsProg.map(p=>[p.op,p]));
  return[...new Set([...hsProg.map(p=>p.op),...Object.keys(reg)])].map(op=>{const p=P[op],r=reg[op],g=p||(r&&r.prog)||{};
    const esp=p?(p.kgPor>0?p.hojasMueble:null):(g.hojasMueble!=null&&g.hojasMueble!==''?+g.hojasMueble:null),mu=num(g.muebles)||0,real=r?r.real:null;
    const difM=real!=null&&esp!=null?real-esp:null;
    const k=real==null?'pend':esp==null?'sinprog':Math.abs(difM)<=hsTol+1e-9?'ok':difM>0?'mas':'menos';
    return{op,modelo:g.modelo||'',mp:modeloPrincipal(g.modelo||''),area:g.area||'',fecha:g.fecha||'',sem:g.fecha?isoWeek(parseISO(g.fecha)):'',mu,esp,real,difM,
      E:esp!=null&&real!=null?esp*mu:0,R:real!=null&&esp!=null?real*mu:0,difT:difM!=null?difM*mu:null,k,com:r&&r.com||'',r,
      raro:!!p&&(!(p.kgPor>0)||!entero(p.hojasMueble)||!entero(p.muebles))}})}
const HSF=['#hff','#hft','#hfw','#hfa','#hfs','#hfq'];
function hsFiltrar(D){const f=$('#hff').value,t=$('#hft').value,w=$('#hfw').value,a=$('#hfa').value,s=$('#hfs').value,q=$('#hfq').value.trim().toUpperCase();
  return D.filter(x=>(!f||x.fecha>=f)&&(!t||x.fecha<=t)&&(!w||x.sem===w)&&(!a||x.area===a)&&(!s||(s==='dif'?x.k==='mas'||x.k==='menos':s==='pcorr'?hsPorCorregir(x)&&!x.r.rev:x.k===s))&&(!q||(x.op+' '+x.modelo+' '+x.mp).toUpperCase().includes(q)))}
function hsOpcFiltros(D){const s=$('#hfw'),v=s.value,W=[...new Set(D.map(x=>x.sem).filter(Boolean))].sort().reverse();
  s.innerHTML='<option value="">Todas</option>'+W.map(w=>`<option value="${w}">${typeof semTxt==='function'?semTxt(w):w}</option>`).join('');s.value=W.includes(v)?v:'';
  const e=$('#hfs');if(!e.options.length)e.innerHTML='<option value="">Todos</option><option value="dif">Con diferencia (de más o de menos)</option>'+HS_ESTADOS.map(x=>`<option value="${x.k}">${x.t}</option>`).join('')+'<option value="pcorr">Pendientes de corregir</option>'}
// Resumen numérico de un conjunto de OP (solo las capturadas con esperado entran en hojas y diferencias).
function hsSum(L){const C=L.filter(x=>x.k!=='pend'&&x.k!=='sinprog'),E=C.reduce((s,x)=>s+x.E,0),R=C.reduce((s,x)=>s+x.R,0);
  return{n:L.length,capt:L.filter(x=>x.k!=='pend').length,pend:L.filter(x=>x.k==='pend').length,ok:C.filter(x=>x.k==='ok').length,mas:C.filter(x=>x.k==='mas').length,menos:C.filter(x=>x.k==='menos').length,
    sp:L.filter(x=>x.k==='sinprog').length,C:C.length,E,R,net:R-E,abs:C.reduce((s,x)=>s+Math.abs(x.difT),0),P:C.filter(x=>x.difT>0).reduce((s,x)=>s+x.difT,0),N:C.filter(x=>x.difT<0).reduce((s,x)=>s+x.difT,0)}}
const sgn=v=>v==null?'—':(v>0?'+':'')+nfmt(v);
const kpiH=(t,v,c,sub)=>`<div class="kpi"><span class="mut">${t}</span><b class="${c||''}">${v}</b>${sub?`<span class="mut">${sub}</span>`:''}</div>`;
const pctTxt=(a,b)=>b?Math.round(a/b*100)+' %':'—';
function hsKpis(s){return`<div class="kpis">${kpiH('OP en el periodo',s.n,'',`${s.capt} capturadas · ${s.pend} pendientes`)}${kpiH('Correctas',pctTxt(s.ok,s.C),'c-ok',`${s.ok} de ${s.C} capturadas`)}
  ${kpiH('Con diferencia',s.mas+s.menos,s.mas+s.menos?'pos':'',`${s.mas} de más · ${s.menos} de menos`)}${kpiH('Hojas esperadas → reales',`${nfmt(s.E)} → ${nfmt(s.R)}`,'',`Variación ${pct(s.R,s.E)}`)}
  ${kpiH('Diferencia neta (hojas)',sgn(s.net),s.net>0?'pos':s.net<0?'neg':'',`Absoluta ${nfmt(s.abs)} hojas`)}</div>`}
let hsLim=100,hsOrden='fecha',hsDet=PREF.get('hs_tdet')==='1';
// «Corregido» = marca de Administración en el Tablero para OP con diferencia o sin programar (ya se revisó/corrigió).
// No cambia el estado ni los números; sirve para saber qué falta atender (filtro «Pendientes de corregir» y alertas).
const hsPorCorregir=x=>!!x.r&&(x.k==='mas'||x.k==='menos'||x.k==='sinprog');
function hsCeldaCorr(x){if(!hsPorCorregir(x))return'';
  if(x.r.rev)return`<span class="chip ok">✓ Corregido</span><br><span class="mut">${esc(x.r.rev.por||'')} · ${dmy(x.r.rev.ts)}</span><br><a href="#" class="w" data-hsuncorr="${esc(x.op)}">Deshacer</a>`;
  return`<button class="btn ghost sm w" data-hscorr="${esc(x.op)}" type="button">Marcar corregido</button>`}
function hsTablero(){const D=hsDatos();hsOpcFiltros(D);const L=hsFiltrar(D),s=hsSum(L),n={};L.forEach(x=>n[x.k]=(n[x.k]||0)+1);
  const S=hsOrden==='dif'?[...L].sort((a,b)=>Math.abs(b.difT||0)-Math.abs(a.difT||0)||a.op.localeCompare(b.op)):[...L].sort((a,b)=>String(b.fecha).localeCompare(String(a.fecha))||a.op.localeCompare(b.op));
  $('#hfsum').textContent=`${L.length} de ${D.length} OP`+(HSF.some(x=>$(x).value.trim())?' (con filtros)':'');
  $('#hsv-tab').innerHTML=`<div class="card">${hsKpis(s)}<div class="leg">${HS_ESTADOS.map(x=>`<button type="button" data-hst="${x.k}" class="${$('#hfs').value===x.k?'on':''}"><i class="${x.c}" style="background:currentColor"></i>${x.t} <b>${n[x.k]||0}</b></button>`).join('')}</div>
    <div class="row" style="margin:6px 0 4px;align-items:center"><span class="mut">Ordenar por</span><select id="hsord" style="width:auto"><option value="fecha"${hsOrden==='fecha'?' selected':''}>Fecha de programa</option><option value="dif"${hsOrden==='dif'?' selected':''}>Mayor diferencia</option></select>
    <label class="mut" style="flex:0 0 auto;margin-left:auto;white-space:nowrap"><input type="checkbox" id="hsdet" style="width:auto"${hsDet?' checked':''}> Mostrar diferencia total, estado, comentario y corrección</label></div>
    <div class="scroll"><table class="tc${hsDet?'':' nohdet'}"><thead><tr><th>Programa</th><th>Área</th><th>OP / Modelo</th><th class="n">Muebles</th><th class="n">Hojas/mueble<br><span class="mut">esp. → real</span></th><th class="n">Dif. por mueble</th><th class="n hdet">Dif. total</th><th class="hdet">Estado</th><th class="hdet">Comentario</th><th class="hdet">Corrección</th></tr></thead><tbody>`+
    (S.length?S.slice(0,hsLim).map(x=>`<tr class="r-${HSE[x.k].c.slice(3)}"><td>${dmyISO(x.fecha)}</td><td>${AREA_TXT[x.area]||'—'}</td><td><b>${esc(x.modelo)}</b><br><span class="mut">${esc(x.op)}</span>${x.raro?'<br><span class="pos" style="font-size:12px">Programación por revisar</span>':''}</td>
      <td class="n">${x.mu?nfmt(x.mu):'—'}</td><td class="n">${x.esp!=null?nfmt(x.esp):'—'} → ${x.real!=null?nfmt(x.real):'—'}</td><td class="n"><span class="${x.difM>hsTol?'pos':x.difM<-hsTol?'neg':''}">${sgn(x.difM)}</span>${!hsDet&&x.r&&x.r.rev?' <span class="c-ok" title="Corregido">✓</span>':''}${!hsDet&&x.com?` <span title="${esc(x.com)}">💬</span>`:''}</td><td class="n hdet">${sgn(x.difT)}</td><td class="hdet">${hsChip(x.k)}</td><td class="mut hdet" style="white-space:normal;min-width:120px">${esc(x.com)}</td><td class="hdet ccor">${hsCeldaCorr(x)}</td></tr>`).join(''):'<tr><td colspan="10" class="mut">No hay OP con estos filtros.</td></tr>')+
    `</tbody></table></div>${S.length>hsLim?`<p><button class="btn ghost sm" id="hsmas" type="button">Mostrar más (${S.length-hsLim})</button></p>`:''}</div>`}
// Análisis: resumen, por área, por semana, OP con mayor diferencia, por modelo y alertas.
function hsAnalisis(){const D=hsDatos();hsOpcFiltros(D);const L=hsFiltrar(D),s=hsSum(L);$('#hfsum').textContent=`${L.length} de ${D.length} OP`+(HSF.some(x=>$(x).value.trim())?' (con filtros)':'');
  const sec=(n,t,b)=>`<section class="card sec"><h2><span class="sn">${n}</span> ${t}</h2>${b}</section>`;
  const fila=(k,g)=>{const x=hsSum(g);return`<tr><td>${k}</td><td class="n">${x.n}</td><td class="n">${x.capt}</td><td class="n">${pctTxt(x.ok,x.C)}</td><td class="n">${x.mas+x.menos}</td><td class="n">${nfmt(x.E)}</td><td class="n">${nfmt(x.R)}</td><td class="n ${x.net>0?'pos':x.net<0?'neg':''}">${sgn(x.net)}</td><td class="n">${pct(x.R,x.E)}</td></tr>`};
  const thG=t=>`<thead><tr><th>${t}</th><th class="n">OP</th><th class="n">Capturadas</th><th class="n">Correctas</th><th class="n">Con dif.</th><th class="n">Esperadas</th><th class="n">Reales</th><th class="n">Dif. neta</th><th class="n">Variación</th></tr></thead>`;
  const grupo=(fn)=>{const m={};L.forEach(x=>{const k=fn(x);(m[k]=m[k]||[]).push(x)});return m};
  const C=L.filter(x=>x.k==='mas'||x.k==='menos'),top=[...C].sort((a,b)=>Math.abs(b.difT)-Math.abs(a.difT)).slice(0,10);
  // Por modelo principal (agrupación provisional de Cartón): hojas por mueble típicas vs reales
  const M=Object.entries(grupo(x=>x.mp)).map(([k,g])=>{const c=g.filter(x=>x.k!=='pend'&&x.k!=='sinprog'),d=c.filter(x=>x.k==='mas'||x.k==='menos');
    const espT=c.length?med(c.map(x=>x.esp)):null,realP=c.length?c.reduce((s2,x)=>s2+x.real,0)/c.length:null;
    return{k,n:g.length,c:c.length,d:d.length,espT,realP,difP:c.length?c.reduce((s2,x)=>s2+x.difM,0)/c.length:null,abs:c.reduce((s2,x)=>s2+Math.abs(x.difT),0),vars:[...new Set(g.map(x=>x.modelo))]}})
    .filter(m=>m.c).sort((a,b)=>b.d-a.d||b.abs-a.abs);
  const al=[];const raros=L.filter(x=>x.raro);if(raros.length)al.push(['at',`<b>${raros.length} OP con programación por revisar en Dynamics</b> (Cantidad por en 0 o fracciones de hoja/mueble): ${raros.slice(0,8).map(x=>esc(x.op)).join(', ')}${raros.length>8?'…':''}`]);
  const hoy=ymd(new Date()),viejas=L.filter(x=>x.k==='pend'&&x.fecha&&x.fecha<hoy);if(viejas.length)al.push(['at',`<b>${viejas.length} OP pendientes de capturar</b> con fecha de programa ya pasada.`]);
  if(s.sp)al.push(['at',`<b>${s.sp} OP sin programar</b> (agregadas a mano, no vienen en el programa del ERP).`]);
  const pc=L.filter(x=>hsPorCorregir(x)&&!x.r.rev).length;if(pc)al.push(['at',`<b>${pc} OP con diferencia pendientes de corregir</b> (en Tablero usa el filtro «Pendientes de corregir»).`]);
  const rep=M.filter(m=>m.d>=2);if(rep.length)al.push(['at',`<b>${rep.length} modelo(s) con diferencia en 2 o más OP</b>: ${rep.slice(0,6).map(m=>esc(m.k)).join(', ')}. Revisar si la lista de materiales del ERP está bien.`]);
  if(!al.length)al.push(['ok','Sin alertas en el periodo filtrado.']);
  $('#hsv-ana').innerHTML=
    sec(1,'Resumen',hsKpis(s)+(s.C?`<ul class="rx">${[
      ['in',`De ${s.C} OP capturadas, <b>${s.ok}</b> coinciden con lo programado y <b>${s.mas+s.menos}</b> tienen diferencia (${s.mas} usaron de más y ${s.menos} de menos).`],
      ['in',`Se usaron <b>${nfmt(s.R)}</b> hojas contra <b>${nfmt(s.E)}</b> esperadas: diferencia neta de <b>${sgn(s.net)}</b> hojas (${pct(s.R,s.E)}).`+(s.P&&s.N?` Hay compensación: +${nfmt(s.P)} de más y ${nfmt(s.N)} de menos.`:'')],
      ...(top[0]?[['at',`Mayor diferencia: <b>${esc(top[0].op)}</b> (${esc(top[0].modelo)}), ${sgn(top[0].difM)} hojas por mueble = ${sgn(top[0].difT)} en total.`]]:[])].map(([k,t])=>`<li class="rx-${k}">${t}</li>`).join('')}</ul>`:'<p class="mut">Todavía no hay OP capturadas en este periodo.</p>'))+
    sec(2,'Alertas',`<ul class="rx">${al.map(([k,t])=>`<li class="rx-${k}">${t}</li>`).join('')}</ul>`)+
    sec(3,'OP con mayor diferencia',top.length?`<div class="scroll"><table class="tc"><thead><tr><th>OP / Modelo</th><th>Programa</th><th>Área</th><th class="n">Muebles</th><th class="n">Hojas/mueble<br><span class="mut">esp. → real</span></th><th class="n">Dif. total</th><th>Comentario</th></tr></thead><tbody>${top.map(x=>`<tr><td><b>${esc(x.modelo)}</b><br><span class="mut">${esc(x.op)}</span></td><td>${dmyISO(x.fecha)}</td><td>${AREA_TXT[x.area]||'—'}</td><td class="n">${nfmt(x.mu)}</td><td class="n">${nfmt(x.esp)} → ${nfmt(x.real)}</td><td class="n ${x.difT>0?'pos':'neg'}">${sgn(x.difT)}</td><td class="mut" style="white-space:normal">${esc(x.com)}</td></tr>`).join('')}</tbody></table></div>`:'<p class="mut">Ninguna OP con diferencia en el periodo.</p>')+
    sec(4,'Por modelo',M.length?`<p class="mut">Modelo principal (agrupa colores y variantes con las mismas reglas de Cartón). Ordenado por número de OP con diferencia.</p><div class="scroll"><table class="tc"><thead><tr><th>Modelo</th><th class="n">OP capt.</th><th class="n">Con dif.</th><th class="n">Hojas/mueble<br><span class="mut">esperadas</span></th><th class="n">Real promedio</th><th class="n">Dif. promedio</th><th class="n">Dif. absoluta</th><th>Variantes</th></tr></thead><tbody>${M.slice(0,30).map(m=>`<tr${m.d>=2?' class="fx"':''}><td><b>${esc(m.k)}</b></td><td class="n">${m.c}</td><td class="n">${m.d}</td><td class="n">${nfmt(m.espT)}</td><td class="n">${m.realP.toFixed(2)}</td><td class="n ${m.difP>hsTol?'pos':m.difP<-hsTol?'neg':''}">${(m.difP>0?'+':'')+m.difP.toFixed(2)}</td><td class="n">${nfmt(m.abs)}</td><td class="mut" style="white-space:normal">${m.vars.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></div>${M.length>30?`<p class="mut">Se muestran 30 de ${M.length}. Usa el filtro de OP o modelo para ver otro.</p>`:''}`:'<p class="mut">Sin OP capturadas.</p>')+
    sec(5,'Por área',`<div class="scroll"><table class="tc">${thG('Área')}<tbody>${HS.orden.map(a=>fila(AREA_TXT[a],L.filter(x=>x.area===a))).join('')}<tr class="tt">${fila('Total',L).slice(4)}</tbody></table></div>`)+
    sec(6,'Por semana de programa',`<div class="scroll"><table class="tc">${thG('Semana')}<tbody>${Object.entries(grupo(x=>x.sem||'(sin fecha)')).sort((a,b)=>b[0].localeCompare(a[0])).map(([k,g])=>fila(typeof semTxt==='function'&&k.includes('-S')?semTxt(k):k,g)).join('')}</tbody></table></div>`)}
// Exportar a Excel lo filtrado (un renglón por OP).
function hsExcel(){const L=hsFiltrar(hsDatos()).sort((a,b)=>String(a.fecha).localeCompare(String(b.fecha))||a.op.localeCompare(b.op));if(!L.length){alert('No hay OP con el filtro actual.');return}
  const r2x=v=>v==null?'':Math.round(v*100)/100;
  const A=L.map(x=>({'Fecha de programa':dmyISO(x.fecha),'Semana':x.sem,'Área':AREA_TXT[x.area]||'','OP':x.op,'Modelo':x.modelo,'Modelo principal':x.mp,'Muebles programados':x.mu||'',
    'Hojas por mueble (esperadas)':r2x(x.esp),'Hojas por mueble (reales)':r2x(x.real),'Diferencia por mueble':r2x(x.difM),'Hojas esperadas (total)':x.k==='pend'||x.esp==null?'':r2x(x.esp*x.mu),
    'Hojas reales (total)':x.real==null?'':r2x(x.real*x.mu),'Diferencia total':r2x(x.difT),'Variación %':x.difM!=null&&x.esp?Math.round(x.difM/x.esp*1000)/10:'','Estado':HSE[x.k].t,
    'Programación por revisar':x.raro?'Sí':'','Comentario':x.com,'Capturado por':x.r?(x.r.por||''):'','Fecha de captura':x.r?dmy(x.r.ts):''}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(A),'Hojas single');XLSX.writeFile(wb,'hojas-single-'+ymd(new Date())+'.xlsx')}
// Tolerancia (± hojas por mueble): la cambia Administración; se guarda en la configuración de la app.
async function hsLeerTol(){try{if(NUBE){const {data}=await SBC.from('config').select('v').eq('k','hs_tol');hsTol=data&&data[0]&&fin(+data[0].v)?+data[0].v:0}else hsTol=+(localStorage.getItem('hs_tol')||0)||0}catch(e){hsTol=0}}
async function hsGuardarTol(v){if(NUBE){const {error}=await SBC.from('config').upsert([{k:'hs_tol',v,updated_at:new Date().toISOString()}],{onConflict:'k'});if(error)throw new Error(error.message)}else localStorage.setItem('hs_tol',String(v));hsTol=v}
$('#hstol').onchange=async e=>{const v=Math.max(0,num(e.target.value));e.target.value=v;try{await hsGuardarTol(v);$('#hstolmsg').textContent=`✓ Tolerancia guardada: ±${nfmt(v)} hoja(s) por mueble.`}catch(x){$('#hstolmsg').textContent='⚠ No se pudo guardar: '+x.message}};
const hsRefrescar=()=>{hsLim=100;if(hsTab==='tab')hsTablero();else if(hsTab==='ana')hsAnalisis()};
HSF.forEach(s=>$(s).addEventListener(s==='#hfq'?'input':'change',hsRefrescar));
$('#hfclr').onclick=()=>{HSF.forEach(s=>$(s).value='');hsRefrescar()};
$('#hfx').onclick=()=>hsExcel();
$('#hsv-tab').addEventListener('click',e=>{const b=e.target.closest('[data-hst]');if(b){$('#hfs').value=$('#hfs').value===b.dataset.hst?'':b.dataset.hst;hsTablero();return}if(e.target.id==='hsmas'){hsLim+=100;hsTablero()}});
$('#hsv-tab').addEventListener('change',e=>{if(e.target.id==='hsord'){hsOrden=e.target.value;hsTablero()}
  if(e.target.id==='hsdet'){hsDet=e.target.checked;PREF.set('hs_tdet',hsDet?'1':'');hsTablero()}});
// Marcar / deshacer «Corregido» (relee antes de guardar para no pisar cambios de otro usuario).
$('#hsv-tab').addEventListener('click',async e=>{const op=e.target.dataset.hscorr||e.target.dataset.hsuncorr;if(!op)return;e.preventDefault();
  try{await hsCargarDatos();const r=hsRegBy()[op];if(!r)return;await HDB.saveRegistro({...r,rev:e.target.dataset.hscorr?{por:quien(),ts:Date.now()}:null});await hsCargarDatos();hsTablero()}
  catch(x){dbErr(x,'No se pudo marcar')}});

/* ==== NAVEGACIÓN DEL MÓDULO ==== */
let hsTab='prog';
async function hsAbrir(t){t=t||hsTab;
  if(t!==hsTab&&hsTab==='cap'&&hcDirty()&&!confirm('Tienes cambios sin guardar en la captura. ¿Descartarlos?'))return;
  if(t!=='cap'){hcEdit={};hcExtra=[]}hsTab=t;
  document.querySelectorAll('#subhojas button').forEach(b=>b.classList.toggle('on',b.dataset.hs===hsTab));
  ['prog','cap','tab','ana'].forEach(k=>$('#hsv-'+k).classList.toggle('hide',k!==hsTab));$('#hsflt').classList.toggle('hide',hsTab!=='tab'&&hsTab!=='ana');
  try{stat('Cargando hojas single…');await Promise.all([hsCargarDatos(),hsLeerTol()]);stat('')}catch(x){dbErr(x,'Hojas single')}
  $('#hstol').value=hsTol;
  if(hsTab==='cap')hsCapturaView();else if(hsTab==='tab')hsTablero();else if(hsTab==='ana')hsAnalisis();else hsProgramaView();
}
$('#subhojas').addEventListener('click',e=>{const b=e.target.closest('[data-hs]');if(b)hsAbrir(b.dataset.hs)});
$('#hsfile').onchange=e=>{const f=e.target.files[0];if(f)hsSubirExcel(f);e.target.value=''};
$('#hsfecha').onchange=e=>{hsFecha=e.target.value;hsProgramaView(true)};
$('#hspdf').onclick=()=>hsGenerarPDF();
$('#hsmsg').addEventListener('click',async e=>{if(e.target.id!=='hsforzar'||!hsPend)return;e.target.disabled=true;
  try{await HDB.upsertPrograma(hsPend);await hsCargarDatos();e.target.parentElement.innerHTML=`<b>✓ Se actualizaron ${hsPend.length} OP que ya tenían real capturado.</b>`;hsPend=null;hsProgramaView(true)}
  catch(x){e.target.disabled=false;dbErr(x,'No se pudo actualizar')}});
