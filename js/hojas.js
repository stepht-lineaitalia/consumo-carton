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
  const L=hsDelDia(hsFecha),c=k=>L.filter(p=>p.area===k).length;
  $('#hsinfo').innerHTML=fs.length?`${HS.orden.map(k=>`<b>${AREA_TXT[k]}:</b> ${c(k)} OP`).join(' · ')}`:'Carga primero el Excel del ERP.';
  $('#hspdf').disabled=!L.length;
  const conReal=new Set(hsReg.map(r=>r.op));
  $('#hstabla').innerHTML=L.length?`<div class="scroll"><table class="tc"><thead><tr><th>Área</th><th>OP</th><th>Modelo</th><th class="n">Muebles</th><th class="n">Hojas por mueble</th><th class="n">Hojas totales</th><th>Real</th></tr></thead><tbody>`+
    L.map(p=>{const raro=!(p.kgPor>0)||!entero(p.hojasMueble)||!entero(p.muebles);
      return`<tr${raro?' class="fx"':''}><td>${AREA_TXT[p.area]}</td><td>${esc(p.op)}</td><td>${esc(p.modelo)}</td><td class="n">${nfmt(p.muebles)}</td><td class="n">${nfmt(p.hojasMueble)}</td><td class="n">${nfmt(p.muebles*p.hojasMueble)}</td><td>${conReal.has(p.op)?'<span class="chip ok">Capturado</span>':'<span class="mut">Pendiente</span>'}</td></tr>`}).join('')+
    `</tbody></table></div>`+(L.some(p=>!(p.kgPor>0)||!entero(p.hojasMueble)||!entero(p.muebles))?`<p class="mut" style="margin:6px 0 0">Renglones en rojo: programación por revisar en Dynamics.</p>`:''):'';
  if(!keepMsg&&!hsProg.length)hsMsg('');
}
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
let hcArea='MUEBLES',hcEdit={},hcExtra=[];
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
  return`<tr class="r-${e?e.k:'err'}" data-op="${esc(op)}"><td>${esc(op)}${o.fecha?`<br><span class="mut">Programa ${dmyISO(p.fecha)}</span>`:''}</td><td>${esc(p.modelo||'')}</td>
    <td class="n">${p.muebles!=null&&p.muebles!==''?nfmt(+p.muebles):'—'}</td><td class="n">${esp!=null?nfmt(esp):'—'}</td>
    <td><input class="hcreal" data-op="${esc(op)}" inputmode="decimal" autocomplete="off" value="${esc(rv)}" style="width:80px${isNaN(real)?';border-color:var(--bad)':''}"></td>
    <td class="n hcdif">${dif==null?'—':(dif>0?'+':'')+nfmt(dif)}</td>
    <td class="hcest">${e?`<span class="chip st st-${e.k}">${e.t}</span>`:'<span class="chip err">Número inválido</span>'}${ed?' <span class="mut" title="Sin guardar">●</span>':''}</td>
    <td><input class="hccom" data-op="${esc(op)}" autocomplete="off" value="${esc(hcVal(op,'com'))}" placeholder="Opcional" style="min-width:120px"></td></tr>`}
function hsCapturaView(){
  const fs=[...new Set(hsProg.map(p=>p.fecha).filter(Boolean))].sort().reverse();
  if(!fs.includes(hsFecha))hsFecha=hsFechaDefault([...fs].reverse());
  $('#hcfecha').innerHTML=fs.length?fs.map(f=>`<option value="${f}"${f===hsFecha?' selected':''}>${dmyISO(f)}</option>`).join(''):'<option value="">— Sin programa cargado —</option>';
  $('#hcarea').value=hcArea;
  const {dia,pend,sinp}=hcFilas(),reg=hsRegBy(),todas=[...dia,...pend];
  const capt=todas.filter(p=>reg[p.op]).length,dif=todas.filter(p=>reg[p.op]&&p.kgPor>0&&Math.abs(reg[p.op].real-p.hojasMueble)>hsTol+1e-9).length;
  $('#hcinfo').innerHTML=fs.length?`<b>${dia.length}</b> OP de ${AREA_TXT[hcArea].toLowerCase()} en esta fecha · ${dia.filter(p=>reg[p.op]).length} capturadas · ${dia.filter(p=>!reg[p.op]).length} pendientes`+
    (dif?` · <b style="color:var(--bad)">${dif} con diferencia</b>`:'')+(pend.length?` · <b style="color:var(--warn)">${pend.length} pendientes de fechas anteriores</b>`:''):'Carga primero el programa en «Programa».';
  const head='<thead><tr><th>OP</th><th>Modelo</th><th class="n">Muebles</th><th class="n">Hojas por mueble</th><th>Reales por mueble</th><th class="n">Diferencia</th><th>Estado</th><th>Comentario</th></tr></thead>';
  let h=dia.map(p=>hcRow(p)).join('')+sinp.map(r=>hcRow({op:r.op,modelo:r.prog.modelo,muebles:r.prog.muebles,kgPor:0})).join('');
  if(pend.length)h+=`<tr><td colspan="8" style="background:var(--warnbg);color:var(--warn);font-weight:600">Pendientes de fechas anteriores (${pend.length})</td></tr>`+pend.map(p=>hcRow(p,{fecha:1})).join('');
  h+=hcExtra.map((x,i)=>`<tr class="r-pend"><td colspan="8"><div class="row"><label>OP agregada a mano<input class="hcxop" data-i="${i}" value="${esc(x.op)}" placeholder="OP…" autocomplete="off"></label><label>Modelo<input class="hcxmod" data-i="${i}" value="${esc(x.modelo)}" autocomplete="off"></label><label>Muebles<input class="hcxmu" data-i="${i}" value="${esc(x.muebles)}" inputmode="numeric"></label><label>Reales por mueble<input class="hcxreal" data-i="${i}" value="${esc(x.real)}" inputmode="decimal"></label><button class="btn ghost sm" data-hcxdel="${i}" type="button">Quitar</button></div></td></tr>`).join('');
  $('#hctabla').innerHTML=dia.length||pend.length||sinp.length||hcExtra.length?`<div class="scroll"><table id="hctab" class="tc">${head}<tbody>${h}</tbody></table></div>`:'<p class="mut">No hay OP de esta área para la fecha elegida.</p>';
}
const hcDirty=()=>Object.values(hcEdit).some(e=>Object.keys(e).length)||hcExtra.some(x=>x.op||x.real);
function hcSet(op,k,v){const r=hsRegBy()[op],g=r?(k==='real'?String(r.real):(r.com||'')):'';const e=hcEdit[op]||(hcEdit[op]={});if(v===g)delete e[k];else e[k]=v}
function hcRepinta(tr){const op=tr.dataset.op,p=hsProg.find(x=>x.op===op)||{op,kgPor:0,modelo:(hsRegBy()[op]||{prog:{}}).prog.modelo,muebles:(hsRegBy()[op]||{prog:{}}).prog.muebles};
  const pend=!!tr.querySelector('.mut')&&tr.cells[0].querySelector('.mut');const tmp=document.createElement('tbody');tmp.innerHTML=hcRow(p,{fecha:pend});const n=tmp.firstElementChild;
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
const hcCambiar=fn=>{if(hcDirty()&&!confirm('Tienes cambios sin guardar en la captura. ¿Descartarlos?'))return false;hcEdit={};hcExtra=[];hcMsg('');fn();hsCapturaView();return true};
$('#hcfecha').onchange=e=>{const v=e.target.value;if(!hcCambiar(()=>hsFecha=v))e.target.value=hsFecha};
$('#hcarea').onchange=e=>{const v=e.target.value;if(!hcCambiar(()=>hcArea=v))e.target.value=hcArea};
window.addEventListener('beforeunload',e=>{if(hcDirty()){e.preventDefault();e.returnValue=''}});

/* ==== NAVEGACIÓN DEL MÓDULO ==== */
let hsTab='prog';
async function hsAbrir(t){t=t||hsTab;
  if(t!==hsTab&&hsTab==='cap'&&hcDirty()&&!confirm('Tienes cambios sin guardar en la captura. ¿Descartarlos?'))return;
  if(t!=='cap'){hcEdit={};hcExtra=[]}hsTab=t;
  document.querySelectorAll('#subhojas button').forEach(b=>b.classList.toggle('on',b.dataset.hs===hsTab));
  ['prog','cap'].forEach(k=>$('#hsv-'+k).classList.toggle('hide',k!==hsTab));
  try{stat('Cargando hojas single…');await hsCargarDatos();stat('')}catch(x){dbErr(x,'Hojas single')}
  if(hsTab==='cap')hsCapturaView();else hsProgramaView();
}
$('#subhojas').addEventListener('click',e=>{const b=e.target.closest('[data-hs]');if(b)hsAbrir(b.dataset.hs)});
$('#hsfile').onchange=e=>{const f=e.target.files[0];if(f)hsSubirExcel(f);e.target.value=''};
$('#hsfecha').onchange=e=>{hsFecha=e.target.value;hsProgramaView(true)};
$('#hspdf').onclick=()=>hsGenerarPDF();
$('#hsmsg').addEventListener('click',async e=>{if(e.target.id!=='hsforzar'||!hsPend)return;e.target.disabled=true;
  try{await HDB.upsertPrograma(hsPend);await hsCargarDatos();e.target.parentElement.innerHTML=`<b>✓ Se actualizaron ${hsPend.length} OP que ya tenían real capturado.</b>`;hsPend=null;hsProgramaView(true)}
  catch(x){e.target.disabled=false;dbErr(x,'No se pudo actualizar')}});
