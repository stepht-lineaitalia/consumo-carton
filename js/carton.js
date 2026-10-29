// Módulo CARTÓN: reglas de negocio, capa de datos, captura de planta, Tablero, Análisis, Modelos y exportaciones.
// Se carga después de comun.js y antes de app.js (los tres comparten el mismo ámbito global).
/* ==== REGLAS DE NEGOCIO CONFIGURABLES ====
   Valores iniciales; el admin los cambia desde Configuración y se guardan con DB.saveSettings (viven como datos, no en el código). */
const DEF_CFG={
  tol:15,
  // Código EXACTO del componente en el ERP → ancho del cartón (cm). Solo estas líneas entran al cargar el Excel.
  cartones:{'10202004':92,'10202002':100,'10202003':120,'10202005':140,'10202006':160},
  // Prefijo de OP → tipo. Se revisa del más largo al más corto. «OP»+número = Normal.
  prefijos:{OPGS:'Garantía servicio',OPAF:'Showroom',OPG:'Garantía',OPV:'Vacuna'},
  // OP que no consumen cartón para este análisis: se descartan al cargar.
  excluir:['OPP','OPM'],
  // Excepciones de agrupación de modelos (código exacto → modelo principal). Inicial: la hoja «Excepciones» del maestro.
  modelosExc:{'C2-2210L':'C2-2210','C2-2203BH':'C2-2203','LINBKD3S-FWN':'LINBKD3S','YPCUBSETT-LD150':'Y-CUBSETTL150','YPCUBSETT-LI150':'Y-CUBSETTL150'}
};
let cfg={...JSON.parse(JSON.stringify(DEF_CFG)),seguimiento:{}};
const KINDS={op:'OP',ing:'Caja de Ingeniería',inc:'Inclusión'};
const prefOp=op=>(String(op).toUpperCase().match(/^[A-Z]+/)||[''])[0];
function tipoOp(op){
  const s=String(op||'').toUpperCase().trim();
  const p=Object.keys(cfg.prefijos).sort((a,b)=>b.length-a.length).find(k=>s.startsWith(k.toUpperCase()));
  if(p)return cfg.prefijos[p];
  if(/^OP\d/.test(s))return'Normal';
  return'Otro ('+(prefOp(s)||'sin prefijo')+')';
}
const opDesconocida=op=>/^Otro \(/.test(tipoOp(op));
// Excluida si sus letras iniciales son exactamente un prefijo excluido (OPP00012 → «OPP»).
const excluida=op=>{const p=prefOp(op);return!!p&&cfg.excluir.some(q=>String(q).toUpperCase().trim()===p)};
// Tipo que se muestra en tablero, filtros, análisis y exportación (se calcula al leer, no se guarda).
const tipoReg=r=>r.kind==='op'?tipoOp(r.op):KINDS[r.kind]||KINDS.inc;
const clase=m=>/^F/i.test(String(m).trim())?'Folio':'Línea';
const tipoModelo=clase;

/* ==== AGRUPACIÓN DE MODELOS (PROVISIONAL) ====
   Pieza reemplazable: cuando el negocio entregue sus reglas y claves, se cambia SOLO AGRUPACION.clave (y las excepciones).
   Hoy reproduce las reglas del archivo maestro (hojas Aux_Modelo y Excepciones), en este orden:
   0) excepción explícita (código exacto → modelo principal), editable en la pestaña Modelos;
   1) «C<dígito>-…»  → C2-2210L = «C2-2210»;   2) «SKLASS…» → SKLASS + número;   3) «FA-»/«FC-» → F + número;
   4) «CUB…» → hasta el final del primer número;  5) «KLASS…» → código completo;
   6) sin número → código sin «-ESP»/«-FWN»;      7) con número → el primer número (las letras se consideran color/variante). */
const AGRUPACION={nombre:'Provisional: reglas del archivo maestro',
  clave(cod){
    const c=String(cod==null?'':cod).trim().toUpperCase();if(!c)return'(sin código)';
    const ex=cfg.modelosExc||{};if(ex[c])return String(ex[c]).toUpperCase();
    const dig=x=>(x.match(/^\d+/)||[''])[0];let m;
    if((m=c.match(/^(C\d-)(.*)$/))){const d=dig(m[2]);return d?m[1]+d:c}
    if(c.startsWith('SKLASS'))return'SKLASS'+dig(c.slice(6));
    if(/^F[AC]-/.test(c)){const d=dig(c.slice(3));return d?'F'+d:c}
    if(c.startsWith('CUB')){const k=c.search(/\d/);return k<0?c:c.slice(0,k)+c.slice(k).match(/^\d{1,6}/)[0]}
    if(c.startsWith('KLASS'))return c;
    const k=c.search(/\d/);if(k<0)return c.replace(/-(ESP|FWN)$/,'');
    return String(+c.slice(k).match(/^\d{1,6}/)[0]);
  }};
const modeloPrincipal=cod=>AGRUPACION.clave(cod);

const SAMPLE=[
{op:'OP09252206',modelo:'LINDT7230-ESP',desc:'72X30 DESKTOP W/MOD PANEL-ESPRESSO',cant:5,estado:'Lanzada',term:5,pend:0,fecha:'2026-10-12',demo:1,rows:[{ancho:120,val:25.82}]},
{op:'OP09252635',modelo:'NL134A',desc:'',cant:3,estado:'Lanzada',term:0,pend:3,fecha:'2026-10-14',demo:1,rows:[{ancho:92,val:5.082},{ancho:100,val:5.526}]},
{op:'OP09252616',modelo:'X650',desc:'',cant:1,estado:'Lanzada',term:0,pend:1,fecha:'2026-10-14',demo:1,rows:[{ancho:120,val:3.77},{ancho:92,val:2.59}]}];

/* ==== CAPA DE DATOS (inicio) ====
   Única parte de la app que sabe DÓNDE se guardan los datos; el resto solo llama a DB.*
   Contrato (todo asíncrono; lanza Error si algo falla, nunca falla en silencio):
     listReports()            → reportes válidos (repara los dañados)
     saveReport(rep)          → inserta o reemplaza por id (asigna id si falta) y VERIFICA que quedó guardado
     deleteReport(id)         importReports(arr) → {added,total}
     getCatalog()             upsertOps(ops,{overwrite}) → catálogo resultante (quita las OP de demostración)
     getSettings()            saveSettings({tol,cartones,prefijos,excluir,modelosExc,seguimiento})  (lo que falte toma el valor inicial DEF_CFG)
     listOperadores()         saveOperadores(lista)   (nombres para elegir en planta)
     getAuth() setAuth(a)     contraseña de admin del modo local (en la nube: sesion(), entrar(), salir())
     onChange(cb)             avisa cuando otro usuario/pestaña cambió los reportes
   Implementaciones: LocalDB (navegador) y CloudDB (Supabase). Errores con code: quota, verify, conflict, auth. */
const fin=v=>typeof v==='number'&&isFinite(v);
let nfix=0;
function norm(r){
  if(!r||typeof r!=='object'||Array.isArray(r)){nfix++;return null}
  const o={...r};let fx=false;
  if(o.kind==='sin')o.kind='inc';                       // «Caja sin OP» se eliminó (v4.3): se lee como Inclusión
  if(!['op','ing','inc'].includes(o.kind)){o.kind=(o.op&&o.op!=='—')?'op':'inc';fx=true}
  let ts=Number(o.ts);if(!(ts>0)){ts=Number(o.id);if(!(ts>0))ts=Date.now();fx=true}o.ts=ts;
  if(o.id==null||o.id===''){o.id=ts;fx=true}
  if(!Array.isArray(o.per)){o.per=[];fx=true}
  o.per=o.per.filter(p=>p&&typeof p==='object').map(p=>{const q={...p};['a','E','R','ce','cr'].forEach(k=>{if(!fin(q[k])){q[k]=Number(q[k])||0;fx=true}});return q});
  const S=k=>o.per.reduce((t,p)=>t+p[k],0);
  if(!fin(o.E)){o.E=S('E');fx=true}if(!fin(o.R)){o.R=S('R');fx=true}
  if(!fin(o.diff)){o.diff=o.R-o.E;fx=true}
  if(!fin(o.abs)){o.abs=o.per.reduce((t,p)=>t+Math.abs(p.R-p.E),0);fx=true}
  if(!fin(o.ce)){o.ce=S('ce');fx=true}if(!fin(o.cr)){o.cr=S('cr');fx=true}
  if(!fin(o.cant)){o.cant=Number(o.cant)||0;fx=true}
  if(!fin(o.dm)){o.dm=o.cant?o.diff/o.cant:0;fx=true}
  if(!o.fx||typeof o.fx!=='object'){o.fx={q:0,t:0,d:0,m:0};fx=true}
  ['modelo','op','tipoOp','com','estadoERP'].forEach(k=>{if(typeof o[k]!=='string'){o[k]=o[k]==null?(k==='op'?'—':''):String(o[k]);fx=true}});
  if(typeof o.semana!=='string'||!o.semana){o.semana=isoWeek(new Date(ts));fx=true}
  if(typeof o.venc!=='string')o.venc='';
  if(!o.snap||typeof o.snap!=='object'||!Array.isArray(o.snap.lines)||!Array.isArray(o.snap.rows)){o.snap={rows:[],lines:[],com:o.com};fx=true}
  if(fx)nfix++;return o;
}
// Configuración guardada + valores iniciales (DEF_CFG) para lo que falte o venga dañado. Común a LocalDB y CloudDB.
function mezclarCfg(t,c){c=c||{};const d=JSON.parse(JSON.stringify(DEF_CFG));
  const okMap=(m,f)=>m&&typeof m==='object'&&!Array.isArray(m)&&Object.keys(m).length&&Object.values(m).every(f);
  return{tol:fin(t)?t:DEF_CFG.tol,
    cartones:okMap(c.cartones,v=>fin(v)&&v>0)?c.cartones:d.cartones,
    prefijos:okMap(c.prefijos,v=>typeof v==='string'&&v.trim())?c.prefijos:d.prefijos,
    excluir:Array.isArray(c.excluir)?c.excluir.map(String):d.excluir,
    modelosExc:c.modelosExc&&typeof c.modelosExc==='object'&&!Array.isArray(c.modelosExc)?c.modelosExc:d.modelosExc,
    seguimiento:c.seguimiento&&typeof c.seguimiento==='object'&&!Array.isArray(c.seguimiento)?c.seguimiento:{},
    respaldo:c.respaldo&&fin(c.respaldo.ts)?c.respaldo:null}}
const LocalDB=(()=>{
  const K={rep:'cc_reports3',bad:'cc_reports3_corrupt',cat:'cc_cat3',tol:'cc_tol',cfg:'cc_cfg',auth:'cc_auth',opr:'cc_operadores'};
  let corruptWarned=false;
  const get=(k,d)=>{try{const v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}};
  const put=(k,v)=>{try{localStorage.setItem(k,JSON.stringify(v))}catch(e){const x=new Error('No se pudo escribir en el almacenamiento del navegador (¿lleno?).');x.code='quota';throw x}};
  const newId=a=>{let i=Date.now();const t=new Set(a.map(r=>r.id));while(t.has(i))i++;return i};
  const seed=()=>{const c={};SAMPLE.forEach(o=>c[o.op]=JSON.parse(JSON.stringify(o)));return c};
  const api={name:'local',repaired:0,warn(){},
    read(){
      let raw=null,arr=[];nfix=0;
      try{raw=localStorage.getItem(K.rep)}catch(e){}
      if(raw){try{const p=JSON.parse(raw);if(!Array.isArray(p))throw 0;arr=p}
        catch(e){try{if(localStorage.getItem(K.bad)!==raw)localStorage.setItem(K.bad,raw)}catch(x){}
          if(!corruptWarned){corruptWarned=true;api.warn('⚠ Los reportes guardados no se pudieron leer. Se conservó una copia en el navegador (cc_reports3_corrupt). Avisa al administrador antes de seguir capturando.')}}}
      const seen=new Set(),out=[];
      arr.forEach(r=>{const o=norm(r);if(!o)return;
        if(seen.has(o.id)){let i=Number(o.id)||o.ts;while(seen.has(i))i++;o.id=i;nfix++}
        seen.add(o.id);out.push(o)});
      api.repaired=nfix;return out;
    },
    async listReports(){return api.read()},
    async saveReport(rep){
      const fresh=api.read(),r={...rep};
      if(r.id==null||r.id==='')r.id=newId(fresh);
      put(K.rep,fresh.some(x=>x.id===r.id)?fresh.map(x=>x.id===r.id?r:x):[r,...fresh]);
      if(!api.read().some(x=>x.id===r.id)){const x=new Error('El reporte no quedó en el almacenamiento.');x.code='verify';throw x}
      return r;
    },
    async deleteReport(id){put(K.rep,api.read().filter(r=>String(r.id)!==String(id)))},
    async importReports(arr){
      const inc=arr.map(norm).filter(Boolean),a=api.read(),by=new Map(a.map(r=>[r.id,r]));let add=0;
      inc.forEach(r=>{const x=by.get(r.id);if(x&&x.ts===r.ts)return;if(x)r.id=newId([...a,...inc]);a.push(r);by.set(r.id,r);add++});
      a.sort((p,q)=>q.ts-p.ts);put(K.rep,a);return{added:add,total:a.length};
    },
    async getCatalog(){return get(K.cat,null)||seed()},
    async upsertOps(ops,o){
      const c=get(K.cat,null)||seed();Object.keys(c).forEach(k=>{if(c[k].demo)delete c[k]});
      Object.keys(ops||{}).forEach(k=>{if((o&&o.overwrite)||!c[k])c[k]=ops[k]});put(K.cat,c);return c;
    },
    async getSettings(){return mezclarCfg(get(K.tol,DEF_CFG.tol),get(K.cfg,{})||{})},
    async saveSettings(s){if(!s)return;if('tol' in s)put(K.tol,s.tol);
      const c=get(K.cfg,{})||{};let ch=false;['cartones','prefijos','excluir','modelosExc','seguimiento','respaldo'].forEach(k=>{if(k in s){c[k]=s[k];ch=true}});if(ch)put(K.cfg,c)},
    async listOperadores(){const l=get(K.opr,[]);return Array.isArray(l)?l.map(String):[]},
    async saveOperadores(l){put(K.opr,l)},
    async getAuth(){return get(K.auth,null)},
    async setAuth(a){put(K.auth,a)},
    onChange(cb){window.addEventListener('storage',e=>{if(e.key===K.rep)cb()})}
  };
  return api;
})();
const CloudDB=sb=>{
  // Nube (Supabase/Postgres). Mismo contrato que LocalDB. Tablas y permisos: supabase/esquema.sql.
  // El reporte completo se guarda en «data» (jsonb); id y version los asigna la base.
  const err=(e,code)=>{const x=new Error(e&&e.message||String(e));x.code=code||(e&&e.code);
    if(x.code==='40001'||/conflicto de versión/i.test(x.message)){x.code='conflict';x.message='Otro usuario modificó este reporte mientras lo editabas. Recarga y vuelve a intentar.'}
    if(/JWT|session|401/i.test(x.message)&&x.code!=='conflict')x.code='auth';
    return x};
  const run=async q=>{const {data,error}=await q;if(error)throw err(error);return data};
  // Supabase entrega como máximo 1000 renglones por consulta: se pide por páginas.
  const todo=async mk=>{let out=[],i=0;for(;;){const d=await run(mk().range(i,i+999));out=out.concat(d||[]);if(!d||d.length<1000)return out;i+=1000}};
  const COLS='id,version,rev,operador,data';
  const desde=w=>({...w.data,id:w.id,version:w.version,rev:!!w.rev,operador:w.operador||w.data.operador||''});
  const fila=r=>{const d={...r};['id','version'].forEach(k=>delete d[k]);
    return{ts:r.ts,kind:r.kind,op:r.op,modelo:r.modelo,semana:r.semana,operador:r.operador||null,rev:!!r.rev,data:d}};
  let perfil=null;
  const api={name:'nube',repaired:0,warn(){},
    async listReports(){nfix=0;const rows=await todo(()=>sb.from('reportes').select(COLS).is('deleted_at',null).order('ts',{ascending:false}));
      const out=[];rows.forEach(w=>{const o=norm(desde(w));if(o)out.push(o)});api.repaired=nfix;return out},
    async saveReport(rep){
      if(rep.id==null||rep.id==='')return desde(await run(sb.from('reportes').insert(fila(rep)).select(COLS).single()));
      const v=Number(rep.version)||1;
      const d=await run(sb.from('reportes').update({...fila(rep),version:v+1}).eq('id',rep.id).eq('version',v).select(COLS));
      if(!d||!d.length)throw err({message:''},'40001');
      return desde(d[0])},
    async deleteReport(id){   // borrado lógico: el reporte queda en la base y en la bitácora
      const d=await run(sb.from('reportes').select('id,version').eq('id',id));if(!d||!d.length)return;
      const u=await run(sb.from('reportes').update({deleted_at:new Date().toISOString(),version:d[0].version+1}).eq('id',id).eq('version',d[0].version).select('id'));
      if(!u||!u.length)throw err({message:''},'40001')},
    async importReports(arr){   // sube un respaldo JSON (p. ej. el de un navegador del piloto); no duplica lo que ya está
      const ya=await api.listReports(),k=r=>r.ts+'|'+r.op+'|'+r.modelo,hay=new Set(ya.map(k));
      const nuevos=arr.map(norm).filter(Boolean).filter(r=>!hay.has(k(r))).map(r=>{hay.add(k(r));const x={...r};delete x.id;delete x.version;return fila(x)});
      for(let i=0;i<nuevos.length;i+=500)await run(sb.from('reportes').insert(nuevos.slice(i,i+500)));
      return{added:nuevos.length,total:ya.length+nuevos.length}},
    async getCatalog(){const rows=await todo(()=>sb.from('ops').select('op,data').order('op'));const c={};rows.forEach(w=>c[w.op]=w.data);return c},
    async upsertOps(ops,o){const rows=Object.keys(ops||{}).map(k=>({op:k,data:ops[k],updated_at:new Date().toISOString()}));
      for(let i=0;i<rows.length;i+=500)await run(sb.from('ops').upsert(rows.slice(i,i+500),{onConflict:'op',ignoreDuplicates:!(o&&o.overwrite)}));
      return api.getCatalog()},
    async getSettings(){const rows=await run(sb.from('config').select('k,v'));const c={};(rows||[]).forEach(w=>c[w.k]=w.v);return mezclarCfg(c.tol,c)},
    async saveSettings(s){if(!s)return;const rows=['tol','cartones','prefijos','excluir','modelosExc','seguimiento','respaldo'].filter(k=>k in s).map(k=>({k,v:s[k],updated_at:new Date().toISOString()}));
      if(rows.length)await run(sb.from('config').upsert(rows,{onConflict:'k'}))},
    async listOperadores(){return(await run(sb.from('operadores').select('nombre,activo').order('nombre'))||[]).filter(x=>x.activo).map(x=>x.nombre)},
    async saveOperadores(lista){const ya=await run(sb.from('operadores').select('nombre,activo'))||[],L=new Set(lista);
      const rows=[...lista.map(n=>({nombre:n,activo:true})),...ya.filter(x=>!L.has(x.nombre)).map(x=>({nombre:x.nombre,activo:false}))];
      if(rows.length)await run(sb.from('operadores').upsert(rows,{onConflict:'nombre'}))},
    // Sesión: usuario de Supabase Auth + su rol en «perfiles» (admin / planta / consulta)
    async sesion(){const {data}=await sb.auth.getSession();const u=data&&data.session&&data.session.user;if(!u){perfil=null;return null}
      const p=await run(sb.from('perfiles').select('rol,nombre').eq('user_id',u.id));perfil={email:u.email,rol:p&&p[0]?p[0].rol:null,nombre:p&&p[0]?p[0].nombre:''};return perfil},
    async entrar(email,pw){const {error}=await sb.auth.signInWithPassword({email,password:pw});if(error)throw err({message:/invalid/i.test(error.message)?'Correo o contraseña incorrectos.':error.message},'auth');return api.sesion()},
    async salir(){await sb.auth.signOut()},
    async getAuth(){return null},async setAuth(){},
    onChange(cb){try{sb.channel('reportes').on('postgres_changes',{event:'*',schema:'public',table:'reportes'},()=>cb()).subscribe()}catch(e){}}
  };
  return api;
};
// La app usa la nube si config.js trae la URL y la clave pública del proyecto; si no, trabaja en el navegador (LocalDB).
const NUBE=window.CC_CONFIG&&CC_CONFIG.supabaseUrl&&CC_CONFIG.supabaseAnonKey&&window.supabase;
// Un solo cliente de Supabase para toda la app (Cartón y Hojas single comparten la sesión).
const SBC=NUBE?supabase.createClient(CC_CONFIG.supabaseUrl,CC_CONFIG.supabaseAnonKey,{auth:{persistSession:true,autoRefreshToken:true}}):null;
const DB=NUBE?CloudDB(SBC):LocalDB;
DB.warn=m=>alert(m);
// Preferencias de ESTE equipo (no son datos del negocio): p. ej. el operador elegido. Nunca fallan.
const PREF={get(k){try{return localStorage.getItem('cc_pref_'+k)||''}catch(e){return''}},set(k,v){try{v?localStorage.setItem('cc_pref_'+k,v):localStorage.removeItem('cc_pref_'+k)}catch(e){}}};
/* ==== CAPA DE DATOS (fin) ==== */
let cat={},reports=[],tolv=DEF_CFG.tol,admin=false,W=null,editId=null,saving=false;
// Estado de carga/guardado visible (para cuando los datos vivan en la nube)
const stat=(m,err)=>{const e=$('#dbstat');e.textContent=m||'';e.style.color=err?'var(--bad)':'';e.classList.toggle('hide',!m)};
function dbErr(e,ctx){stat('⚠ '+(ctx?ctx+': ':'')+(e&&e.message||e),true);if(e&&e.code==='quota')alert('⚠ No se pudo guardar en este navegador (almacenamiento lleno). Descarga un respaldo (admin) ya.')}
async function reload(){try{reports=await DB.listReports();return true}catch(e){dbErr(e,'No se pudieron leer los datos');return false}}
const CH={ok:'Correcto',bad:'Con diferencia',pend:'Incompleto',na:'Sin esperado'};
/* ==== ESTADOS (fuente única) ====
   Nombre, nombre corto (leyenda), color y significado de cada estado. La leyenda, las etiquetas, el filtro de Estado,
   las alertas y los colores de Análisis/Modelos salen de esta tabla: agregar, renombrar o recolorear un estado = editar un renglón.
   La regla que asigna cada estado está en estRaw(). El orden es el de la leyenda. */
const ESTADOS=[
  {k:'ok',      t:'Correcto',                                   s:'Correcto',      d:'Coinciden el cartón y los m² (dentro de tolerancia)'},
  {k:'cons',    t:'Diferencia de consumo',                      s:'Consumo',       d:'Mismo cartón; m² fuera de tolerancia'},
  {k:'camb',    t:'Cambio de cartón',                           s:'Cartón',        d:'Se usó otro cartón; m² dentro de tolerancia'},
  {k:'cambcons',t:'Cambio de cartón y diferencia de consumo',   s:'Cartón + m²',   d:'Ni el cartón ni los m² coinciden'},
  {k:'extra',   t:'Caja Extra',                                 s:'Caja Extra',    d:'Además del programado se usó un cartón no programado (puede incluir diferencia de consumo)'},
  {k:'sinprog', t:'Sin programar',                              s:'Sin programar', d:'Consumo real de cartón sin m² programados en el ERP (cartón en 0 m² u OP sin cartón): revisar la programación en Dynamics'},
  {k:'sinop',   t:'Sin OP',                                     s:'Sin OP',        d:'Inclusión o Caja de Ingeniería: consumo sin OP ni esperado'},
  {k:'pend',    t:'Incompleto',                                 s:'Incompleto',    d:'Falta capturar un cartón programado'}];
const EST=Object.fromEntries(ESTADOS.map(x=>[x.k,x]));
const chipE=(e,txt)=>`<span class="chip st st-${e.k}" title="${esc((EST[e.k]||{}).d||'')}">${esc(txt==null?e.t:txt)}</span>`;
/* Estados (ROADMAP «Reglas de negocio»):
   Caja Extra        = además del cartón programado se usó un ancho que el ERP no traía.
   Cambio de cartón  = un ancho programado no se usó y en su lugar se usó otro.
   Cualquiera puede llevar «y diferencia de consumo» si los m² salen de la tolerancia.
   Las cajas NO generan estado (v4.4): la comparación es por m² de cada tipo de cartón; las cajas son dato informativo. */
/* Sin programar (v5.1): consumo real de cartón SIN m² programados en el ERP (p.sp):
     · cartón programado que el ERP trae en 0 m² (p.z), o
     · cartón usado en una OP que no tiene ningún cartón con m² en el ERP (OP sin cartón, o solo cartones en 0 m²).
   Es el estado de mayor prioridad (problema de la programación en Dynamics). Ese consumo va aparte (Rsp): no entra en
   diferencias ni compensación; el resto de los cartones de la OP se compara normal. La app NO corrige la programación:
   el seguimiento es por modelo (Pendiente → Reportado a Dynamics → Corregido en origen). */
const pg=p=>p.prog!=null?!!p.prog:p.E>0;   // ¿cartón programado en el ERP? (registros anteriores a v5.1: E>0)
const SPM={cero:'en 0 m² en el ERP',sinop:'OP sin cartón programado en el ERP',otro:'sin m² programados en el ERP'};
function estRaw(o){
  if(o.kind!=='op'){const t=KINDS[o.kind]||KINDS.inc;return{cls:'na',k:'sinop',t,c:'Sin consumo esperado'}}
  const SP=o.per.filter(p=>p.sp&&p.R>0),b=estBase({...o,per:o.per.filter(p=>!p.sp)});
  if(SP.length)return{cls:'bad',k:'sinprog',base:b.k,t:'Sin programar',c:SP.map(p=>p.spm==='sinop'?`OP sin cartón programado en el ERP: ${p.a} cm, ${fmt(p.R)} m² reales`:`Cartón ${p.a} cm ${SPM[p.spm]||SPM.otro}: ${fmt(p.R)} m² reales`).join(' · ')};
  return b;
}
function estBase(o){
  const P=o.per,U=P.filter(p=>!pg(p)&&p.R>0),X=P.filter(p=>pg(p)&&!p.z&&!p.R),L=a=>a.map(p=>p.a+' cm').join(', ');
  if(!P.some(p=>p.R>0)&&!X.length)return{cls:'ok',k:'ok',t:'Correcto',c:'—'};   // solo consumo sin programar (ya separado)
  if(X.length&&!U.length)return{cls:'pend',k:'pend',t:'Registro incompleto',c:'Falta capturar '+L(X)};
  const ex=U.length&&!X.length,sw=U.length&&X.length,EP=P.filter(p=>p.E&&!p.z),EE=EP.reduce((s,p)=>s+p.E,0),RR=EP.reduce((s,p)=>s+p.R,0);
  const m=ex?(EE&&Math.abs((RR-EE)/EE*100)>tolv):(o.E&&Math.abs((o.R-o.E)/o.E*100)>tolv);
  const y=t=>m?t+' y diferencia de consumo':t;
  // Caja Extra conserva su color aunque además haya diferencia de consumo (la causa principal es la caja extra).
  if(ex)return{cls:'bad',k:'extra',t:y('Caja Extra'),c:'Cartón no programado: '+L(U)};
  if(sw)return{cls:'bad',k:m?'cambcons':'camb',t:y('Cambio de cartón'),c:'Programado '+L(X)+' → usado '+L(U)};
  if(m)return{cls:'bad',k:'cons',t:'Diferencia de consumo',c:'m² fuera de ±'+tolv+'%'};
  return{cls:'ok',k:'ok',t:'Correcto',c:'—'};
}
// est() nunca debe romper el tablero: un registro dañado se clasifica como «ilegible».
const est=o=>{try{return estRaw(o)}catch(x){return{cls:'err',k:'err',t:'Registro ilegible',c:String(x&&x.message||x)}}};
const cartP=r=>r.per.filter(pg).map(p=>p.a+' cm'+(p.z?' (0 m²)':'')).join(' + ')||(r.kind==='op'?'Sin cartón en ERP':'—'),cartU=r=>r.per.filter(p=>p.R>0).map(p=>p.a+' cm').join(' + ')||'—';
const widths=()=>[...new Set([...Object.values(cfg.cartones).map(Number),...Object.values(cat).flatMap(o=>o.rows.map(r=>r.ancho)),...(W&&W.lines?W.lines.map(l=>l.a).filter(Boolean):[])])].sort((a,b)=>a-b);
function showCat(){const C=Object.values(cat).filter(o=>!excluida(o.op));$('#catinfo').textContent='· '+C.length+' OP cargadas';
  $('#mlist').innerHTML=[...new Set(C.map(o=>o.modelo))].map(m=>`<option value="${esc(m)}">`).join('');
}
function showCfg(){
  const c=Object.entries(cfg.cartones).sort((a,b)=>a[1]-b[1]||(a[0]<b[0]?-1:1));
  $('#cartcfg').innerHTML='<table><thead><tr><th>Código</th><th>Ancho</th><th></th></tr></thead><tbody>'+c.map(([k,v])=>`<tr><td>${esc(k)}</td><td>${v} cm</td><td><button class="btn ghost sm" type="button" data-rmcart="${esc(k)}">Quitar</button></td></tr>`).join('')+'</tbody></table>';
  $('#tipcfg').value=Object.entries(cfg.prefijos).map(([k,v])=>k+' = '+v).join('\n');
  $('#exccfg').value=cfg.excluir.join(', ');
}
const cfgMsg=(m,bad)=>{$('#cfgmsg').textContent=m;$('#cfgmsg').style.color=bad?'var(--bad)':''};
async function guardarCartones(c){try{await DB.saveSettings({cartones:c});cfg.cartones=c;showCfg();cfgMsg('Catálogo de cartones guardado. Vuelve a subir el Excel para aplicarlo a las OP.')}catch(x){dbErr(x,'No se pudo guardar el catálogo')}}
$('#addcart').onclick=()=>{const k=codigo($('#ncod').value),a=num($('#nanc').value);
  if(!/^\w+$/.test(k)||!(a>0)){cfgMsg('Escribe el código del componente y un ancho mayor que 0.',true);return}
  $('#ncod').value=$('#nanc').value='';guardarCartones({...cfg.cartones,[k]:a})};
$('#cartcfg').onclick=e=>{const k=e.target.dataset.rmcart;if(k==null)return;
  if(Object.keys(cfg.cartones).length<2){cfgMsg('El catálogo debe tener al menos un cartón.',true);return}
  if(!confirm('¿Quitar el código '+k+' del catálogo? Sus líneas dejarán de cargarse.'))return;
  const c={...cfg.cartones};delete c[k];guardarCartones(c)};
$('#savetip').onclick=async()=>{
  const P={},bad=[];$('#tipcfg').value.split('\n').map(x=>x.trim()).filter(Boolean).forEach(l=>{const m=l.match(/^([A-Za-z]+)\s*=\s*(.+)$/);if(m)P[m[1].toUpperCase()]=m[2].trim();else bad.push(l)});
  if(bad.length||!Object.keys(P).length){cfgMsg('Revisa el formato «PREFIJO = Nombre» en: '+(bad.join(' | ')||'(vacío)'),true);return}
  const X=[...new Set($('#exccfg').value.split(',').map(x=>x.trim().toUpperCase()).filter(Boolean))];
  try{await DB.saveSettings({prefijos:P,excluir:X});cfg.prefijos=P;cfg.excluir=X;showCfg();showCat();cfgMsg('Tipos de OP y exclusiones guardados.')}catch(x){dbErr(x,'No se pudo guardar la configuración')}};
$('#tol').oninput=e=>{tolv=Math.max(0,num(e.target.value));DB.saveSettings({tol:tolv}).catch(x=>dbErr(x,'No se pudo guardar la tolerancia'))};

// Excel
/* Lee las filas del Excel «Consumo Extras» (hoja Data). Reglas (ROADMAP):
   - Entra solo la línea cuyo NoComponente está EXACTAMENTE en cfg.cartones; el ancho sale del catálogo, no de la descripción.
   - OP con prefijo excluido (OPP, OPM…) se descartan.
   - Código desconocido cuya descripción parece «CARTON PARA CAJA … CM» → se reporta con el ancho sugerido (no se pierde en silencio).
   - Renglones repetidos del mismo cartón en una OP (el reporte del ERP no trae número de línea):
       · mismos m² esperados y solo cambian Item/Cantidad (consumos registrados) → es el MISMO renglón repetido por el reporte: cuenta una vez;
       · cualquier otro caso → son piezas/cajas del mismo ancho: se SUMAN (el ERP da el total por tipo de cartón).
   Devuelve {m: OP por número, info: conteos y avisos}. Función pura: no guarda nada. */
const codigo=v=>String(v==null?'':v).trim().replace(/\.0+$/,'');
const vacio=v=>v==null||String(v).trim()===''||String(v).trim().toUpperCase()==='NULL';
const consumoERP=r=>vacio(r.Item)&&vacio(r.Cantidad)?'':codigo(r.Item)+'|'+String(r.Cantidad).trim();
function leerConsumos(rows){
  if(!rows.length||!('NoOP' in rows[0])||!('NoComponente' in rows[0]))throw new Error('Formato no reconocido: faltan las columnas NoOP y NoComponente.');
  const m={},info={excl:new Set(),nuevos:{},contra:{},otros:new Set(),cero:new Set(),sum:new Set(),una:new Set(),lineas:0};
  rows.forEach(r=>{
    const op=String(r.NoOP||'').trim();if(!op)return;
    if(excluida(op)){info.excl.add(op);return}
    // v5.1: TODAS las OP entran al catálogo (aunque no traigan cartón) para que se puedan capturar;
    // si una OP sin cartón programado consume cartón, se marca «Sin programar».
    const o=m[op]||(m[op]={op,modelo:String(r.Modelo),desc:String(r.Descripcion||'').trim(),cant:num(r.Cant)||1,estado:String(r.Estado||''),term:num(r.CantTerminada),pend:num(r.CantPendiente),fecha:isoDate(r.FechaVenc),rows:[]});
    if(opDesconocida(op))info.otros.add(prefOp(op)||op);
    const cod=codigo(r.NoComponente),nm=String(r.NombreComponente||'').toUpperCase(),mt=nm.match(/(\d+)\s*CM/);
    const a=Number(cfg.cartones[cod]);
    if(!a){if(/^CART[OÓ]N PARA CAJA/.test(nm))(info.nuevos[cod]||(info.nuevos[cod]={cod,nombre:String(r.NombreComponente).trim(),ancho:mt?+mt[1]:0,n:0})).n++;return}
    const v=Math.max(0,num(r.CompEsperados));   // una línea con 0 m² también entra: cartón programado sin m²
    if(mt&&+mt[1]!==a)info.contra[cod]={cod,nombre:String(r.NombreComponente).trim(),ancho:a};
    info.lineas++;
    const x=o.rows.find(q=>q.ancho===a),ce=consumoERP(r);
    if(!x){o.rows.push({ancho:a,val:v,cod,src:[{v,ce}],sum:0,una:0});return}
    if(!v)return;                                                                   // otra línea en 0 del mismo ancho: no aporta
    if(ce&&x.src.some(z=>z.v===v&&z.ce&&z.ce!==ce)){x.una++;info.una.add(op);return}   // mismo renglón repetido por el reporte
    x.val+=v;x.sum++;x.src.push({v,ce});info.sum.add(op);                              // otra pieza/caja del mismo ancho
  });
  Object.values(m).forEach(o=>o.rows.forEach(r=>{if(!(r.val>0))info.cero.add(o.op+'|'+r.ancho)}));
  return{m,info};
}
let lastRows=null;
async function cargarConsumos(rows){
  const {m,info}=leerConsumos(rows),ops=Object.values(m),nv=Object.values(info.nuevos);
  if(!ops.length&&!nv.length)throw new Error('No encontré OP en el archivo.');
  if(ops.length){cat=await DB.upsertOps(m,{overwrite:true});showCat()}
  const ct=Object.values(info.contra),L10=a=>esc(a.slice(0,10).join(', '))+(a.length>10?'…':'');
  const sc=ops.filter(o=>!o.rows.length),cc=ops.length-sc.length;
  let h=`<b>Listo:</b> ${ops.length} OP leídas: ${cc} con cartón (${info.lineas} líneas) y ${sc.length} sin cartón programado. ${Object.keys(cat).length} en catálogo.`;
  if(info.excl.size)h+=`<br>Excluidas por tipo (${esc(cfg.excluir.join(', '))}): ${info.excl.size} OP.`;
  if(info.sum.size)h+=`<br>Renglones del mismo cartón <b>sumados</b> (varias piezas o cajas del mismo ancho): ${info.sum.size} OP — ${L10([...info.sum])}.`;
  if(info.una.size)h+=`<br>Renglones repetidos por el reporte, <b>contados una vez</b> (mismos m², solo cambia Item/Cantidad): ${info.una.size} OP — ${L10([...info.una])}.`;
  // Programación del ERP: cartones en 0 m² (casi seguro error) y OP sin cartón (muchas usan caja comprada: solo se cuentan)
  if(info.cero.size){const z=[...info.cero].map(k=>{const [op,a]=k.split('|');return`${esc(op)} · ${esc(m[op].modelo)} · ${a} cm`});
    h+=`<div class="banner sp" style="margin-top:8px">⚠ ${z.length} cartón(es) programados con <b>0 m²</b> en el ERP (revisar en Dynamics). Las OP se pueden capturar; si consumen ese cartón se marcan «Sin programar»:<br>${z.slice(0,15).join('<br>')}${z.length>15?'<br>…':''}</div>`}
  if(sc.length)h+=`<br>${sc.length} OP sin ningún cartón en el ERP (muchas usan caja comprada). Se pueden capturar; solo se marcan «Sin programar» si consumen cartón.`;
  try{const ok=ops.length?await verificarCorrecciones(m):[];if(ok.length)h+=`<br><b style="color:var(--s-ok)">✓ Corregido en origen</b> (ya viene programado en el ERP): ${esc(ok.join(', '))}.`}catch(x){}
  if(info.otros.size)h+=`<br>⚠ Tipo de OP no reconocido, entra como «Otro» para revisión: <b>${esc([...info.otros].join(', '))}</b>. Si es un tipo válido, agrégalo en «Tipos de OP».`;
  if(ct.length)h+=`<br>⚠ La descripción no coincide con el ancho del catálogo (manda el catálogo): `+ct.map(c=>`${esc(c.cod)} «${esc(c.nombre)}» = ${c.ancho} cm`).join('; ')+'.';
  if(nv.length)h+=`<div class="banner pend" style="margin-top:8px">⚠ ${nv.reduce((s,x)=>s+x.n,0)} línea(s) parecen cartón para caja pero su código no está en el catálogo y <b>no se cargaron</b>:<br>`+
    nv.map(x=>`${esc(x.cod)} «${esc(x.nombre)}» → ancho sugerido <b>${x.ancho||'?'} cm</b> (${x.n} línea(s))`).join('<br>')+
    (nv.every(x=>x.ancho>0)?`<br><button class="btn sm" id="regnv" type="button" style="margin-top:6px">Registrar con el ancho sugerido y volver a leer</button>`:'<br>Regístralos en «Catálogo de cartones» y vuelve a subir el archivo.')+'</div>';
  $('#filemsg').innerHTML=h;
  const b=$('#regnv');if(b)b.onclick=async()=>{
    const c={...cfg.cartones};nv.forEach(x=>c[x.cod]=x.ancho);
    try{await DB.saveSettings({cartones:c});cfg.cartones=c;showCfg();await cargarConsumos(lastRows)}catch(x){dbErr(x,'No se pudo guardar el catálogo')}};
  $('#work').classList.add('hide');W=null;
}
$('#file').onchange=async e=>{
  const f=e.target.files[0];if(!f)return;
  try{
    const wb=XLSX.read(await f.arrayBuffer(),{cellDates:true});
    lastRows=XLSX.utils.sheet_to_json(wb.Sheets['Data']||wb.Sheets[wb.SheetNames[0]],{defval:''});
    await cargarConsumos(lastRows);
  }catch(err){$('#filemsg').textContent='Error: '+err.message}
  e.target.value='';
};

// Selección
// OPERADOR = CAPTURAR: la pantalla de captura solo pide lo indispensable (qué registra, cartón, largo, 1 o 2 cartones, cajas, comentario).
// Esperado, diferencias, estados y alertas viven en administración (Análisis, Modelos, Tablero).
// Motivos del cambio de cartón (fuente única: agregar o quitar un motivo = una línea aquí).
const MOTIVOS={exist:'No hay en existencia',inc:'Cartón incorrecto'};
const motTxt=r=>[...new Set((r.mcc||[]).map(x=>MOTIVOS[x.m]||x.m))].join(', ');
// Fecha ISO (aaaa-mm-dd) → dd/mm/aaaa
const fISO=s=>{const m=String(s||'').match(/^(\d{4})-(\d\d)-(\d\d)/);return m?m[3]+'/'+m[2]+'/'+m[1]:''};
const KHINT={ing:'Caja de Ingeniería: escribe el modelo del mueble.',inc:'Inclusión: escribe el modelo del mueble (no tiene OP).'};
$('#kind').onchange=()=>{const k=$('#kind').value;$('#srch').classList.toggle('hide',k!=='op');$('#manual').classList.toggle('hide',k==='op');$('#kindhint').textContent=KHINT[k]||'';$('#work').classList.add('hide');W=null};
$('#q').oninput=()=>{
  const q=$('#q').value.trim().toLowerCase();if(!q){$('#hits').innerHTML='';return}
  const l=Object.values(cat).filter(o=>!excluida(o.op)&&(o.modelo+' '+o.op+' '+o.desc).toLowerCase().includes(q)).slice(0,8);
  $('#hits').innerHTML=l.length?l.map(o=>`<button class="hit" data-k="${esc(o.op)}"><b>${esc(o.modelo)}</b> <span class="mut">${esc(o.op)} · ${o.cant||1} mueble(s)${o.fecha?' · Programa '+fISO(o.fecha):''}</span></button>`).join(''):'<p class="mut">Sin resultados. Revisa el modelo u OP.</p>';
};
$('#hits').onclick=e=>{const b=e.target.closest('.hit');if(b)start('op',b.dataset.k)};
$('#mgo').onclick=()=>{const m=$('#mm').value.trim();if(!m){$('#savemsg').textContent='';alert('Escribe el modelo del mueble.');return}start($('#kind').value,m)};
// Línea de captura: a = ancho, l = largo (cm), c = cartones por caja (0 = sin elegir), n = cajas.
const nl=(a,n)=>({a:+a,l:'',c:0,n:n==null?'':n});
function start(kind,key,saved){
  const s=saved&&saved.snap&&saved.snap.lines.length?saved.snap:null;editId=saved?saved.id:null;
  if(kind==='op'){const o=cat[key];
    W={kind,op:o.op,modelo:o.modelo,desc:o.desc,cant:o.cant||1,estado:o.estado,fecha:o.fecha,rows:o.rows.map(r=>({ancho:r.ancho,val:r.val}))};
  }else W={kind,op:'',modelo:key,desc:'',cant:0,rows:[],fecha:''};
  // cajas prellenadas con Cant (el operador solo cambia si usó otra cantidad)
  W.lines=s?JSON.parse(JSON.stringify(s.lines)):(kind==='op'&&W.rows.length?W.rows.map(r=>({...nl(r.ancho,W.cant),o:r.ancho})):[nl(widths()[0]||140,kind==='op'?W.cant:1)]);
  W.ver=saved?saved.version:undefined;   // versión con la que se empezó a corregir: si otro la cambia mientras tanto, no se pisa
  $('#com').value=W.com=s?s.com:'';W.motErr=false;
  $('#hits').innerHTML='';$('#q').value='';$('#savemsg').textContent='';
  $('#work').classList.remove('hide');render();
}

// Formulario: una tarjeta por cartón
const okC=c=>+c===1||+c===2;
function render(){
  $('#wtitle').textContent=W.modelo+(W.op?' · '+W.op:'');
  $('#wchips').innerHTML=(editId!=null?'<span class="chip pend">Corrigiendo reporte guardado</span> ':'')+(W.kind!=='op'?`<span class="chip na">${esc(KINDS[W.kind])}</span>`:'');
  $('#wmeta').textContent=W.kind==='op'?`${W.cant} mueble(s)`+(W.fecha?` · Fecha de programa: ${fISO(W.fecha)}`:''):'';
  const A=(i,v)=>`<select data-b="${i}" data-f="a">${widths().map(w=>`<option value="${w}"${v==w?' selected':''}>${w} cm</option>`).join('')}</select>`;
  $('#form').innerHTML=W.lines.map((L,i)=>`<div class="card" id="cap${i}"><div class="head"><b>Cartón ${i+1}</b>${W.lines.length>1?`<button class="btn ghost sm" data-rm="${i}" type="button">Quitar</button>`:''}</div>
  <div class="row" style="margin-top:6px"><label>Cartón${A(i,L.a)}</label>
  <label>Largo (cm)<input inputmode="decimal" data-b="${i}" data-f="l" value="${esc(L.l)}"></label>
  <label>Cartones por caja<select data-b="${i}" data-f="c"${okC(L.c)?'':' style="border-color:var(--bad)"'}><option value="0"${okC(L.c)?'':' selected'}>Elige…</option><option value="1"${L.c==1?' selected':''}>1 cartón</option><option value="2"${L.c==2?' selected':''}>2 cartones (tapa y fondo)</option></select></label>
  <label>Cajas<input inputmode="numeric" data-b="${i}" data-f="n" value="${esc(L.n)}"></label></div>${cambiado(L)?panelMot(L,i):''}</div>`).join('');
}
// Cambio del cartón sugerido: solo en tarjetas prellenadas del ERP (L.o = cartón programado) cuyo ancho se cambió.
const cambiado=L=>W.kind==='op'&&L.o!=null&&+L.a!==+L.o;
const panelMot=(L,i)=>`<div class="mot${W.motErr&&!L.m?' err':''}"><b>¿Por qué se cambió el cartón?</b> <span class="mut">Programado ${L.o} cm → usado ${L.a} cm</span>
  <div class="row">${Object.entries(MOTIVOS).map(([k,t])=>`<button type="button" class="btn${L.m===k?'':' ghost'}" data-mot="${k}" data-i="${i}">${L.m===k?'✓ ':''}${esc(t)}</button>`).join('')}</div></div>`;
$('#form').addEventListener('input',e=>{const d=e.target.dataset;if(d.f){const L=W.lines[d.b];L[d.f]=(d.f==='a'||d.f==='c')?+e.target.value:e.target.value;if(d.f==='c')e.target.style.borderColor=e.target.value==='0'?'var(--bad)':'';
  if(d.f==='a'){if(!cambiado(L))delete L.m;render()}}});   // mostrar u ocultar «¿Por qué se cambió el cartón?»
$('#form').addEventListener('click',e=>{const a=e.target.dataset.rm;if(a!==undefined){W.lines.splice(a,1);render();return}
  const m=e.target.closest('[data-mot]');if(m){W.lines[m.dataset.i].m=m.dataset.mot;render()}});
$('#addx').onclick=()=>{if(W){W.lines.push(nl(W.rows[0]?W.rows[0].ancho:(widths()[0]||140),W.kind==='op'?W.cant:1));render()}};
$('#com').oninput=e=>{if(W)W.com=e.target.value};

// Cálculo (todo en m²). m² reales = ancho × largo × cartones por caja × cajas, sumado por tipo de cartón.
// Cajas por ancho = suma de las cajas capturadas en ese ancho (dato informativo; no genera estado).
function calc(){
  const ex={},re={},nlA={};
  W.rows.forEach(r=>ex[r.ancho]=r);
  W.lines.forEach(L=>{const l=num(L.l),n=num(L.n),c=+L.c;if(l<=0||n<=0||!okC(c))return;
    nlA[L.a]=(nlA[L.a]||0)+n;re[L.a]=(re[L.a]||0)+L.a/100*l/100*c*n});
  const A=[...new Set([...Object.keys(ex),...Object.keys(re)].map(Number))].sort((a,b)=>a-b);
  // ¿la OP tiene algún cartón con m² programados? Si no, todo su consumo es «sin programar».
  const conM2=W.rows.some(r=>r.val>0);
  const per=A.map(a=>{
    const x=ex[a],E=x?x.val:0,R=re[a]||0,cr=nlA[a]||0,z=W.kind==='op'&&!!x&&!(E>0);
    const sp=W.kind==='op'&&R>0&&!(E>0)&&(z||!conM2),spm=!sp?undefined:z?'cero':W.rows.length?'otro':'sinop';
    const st=W.kind!=='op'?'na':sp?'sinprog':z?'zero':(E&&!R)?'pend':!E?'bad':Math.abs((R-E)/E*100)<=tolv?'ok':'bad';
    return{a,E,R,diff:R-E,cr,ce:x?W.cant:0,st,prog:!!x,z,...(sp?{sp,spm}:{})};
  });
  return{per,...totales(per,W.kind,W.cant)};
}
// Totales de un reporte a partir de sus cartones. E, R, diff y abs son COMPARABLES (sin el consumo «sin programar»);
// Rsp = consumo real sin m² programados en el ERP (va aparte).
function totales(per,kind,cant){
  const C=per.filter(p=>!p.sp&&!(p.z&&!p.R)),S=(a,k)=>a.reduce((s,p)=>s+(p[k]||0),0),fx={q:0,t:0,d:0,m:0};
  C.forEach(p=>{const E=p.E,R=p.R;if(E&&!R)fx.t-=E;else if(!E)fx.t+=R;else{const q=E*(p.cr/(cant||1)-1);fx.q+=q;fx.m+=R-E-q}});
  const E=S(C,'E'),R=S(C,'R'),Rsp=S(per.filter(p=>p.sp),'R'),diff=R-E;
  const mismo=kind==='op'?per.every(p=>p.sp||(p.z&&!p.R)?true:pg(p)===(p.R>0)):null;
  const e=est({kind,per,E,R,mismo});
  return{fx,E,R,Rsp,diff,abs:C.reduce((s,p)=>s+Math.abs(p.R-p.E),0),dm:cant?diff/cant:0,ce:S(per,'ce'),cr:S(per,'cr'),mismo,st:e.cls,est:e.t};
}
// Real ≈ doble o ≈ mitad del esperado en un cartón programado → se le pide al operador que CONFIRME 1 o 2 cartones.
// Confirmado, se guarda tal cual (sin alerta); administración ve la nota «confirmado por el operador».
function dudas12(per){const out=[];per.filter(p=>p.E&&p.R).forEach(p=>{const k=p.R/p.E;if((k>=1.8&&k<=2.2)||(k>=0.45&&k<=0.55))out.push(p.a)});return out}
const sinElegir=()=>W.lines.map((L,i)=>[L,i]).filter(([L])=>num(L.l)>0&&!okC(L.c)).map(([,i])=>i+1);
const update=()=>{};   // compatibilidad: la captura ya no muestra cálculos en vivo

// Guardar
// Cartones programados en el ERP (con m²) que quedaron sin capturar y que no se cambiaron por otro.
const capt=L=>num(L.l)>0&&num(L.n)>0;
function faltan(){if(W.kind!=='op')return[];
  return W.rows.filter(r=>r.val>0&&!W.lines.some(L=>capt(L)&&(+L.a===+r.ancho||(L.o!=null&&+L.o===+r.ancho)))).map(r=>+r.ancho)}
const yLst=a=>a.length>1?a.slice(0,-1).join(', ')+' y '+a[a.length-1]:String(a[0]);
let faltaA=null;
$('#dfgo').onclick=()=>{$('#dlgf').close();const a=faltaA;let i=W.lines.findIndex(L=>!capt(L)&&(+L.a===a||+L.o===a));
  if(i<0){W.lines.push({...nl(a,W.cant),o:a});i=W.lines.length-1}
  render();const c=$('#cap'+i);if(c){c.classList.add('hl');if(c.scrollIntoView)c.scrollIntoView({block:'center'})}
  const f=$(`[data-b="${i}"][data-f="l"]`);if(f)f.focus()};
$('#dfsk').onclick=()=>{$('#dlgf').close();guardar(true)};
$('#save').onclick=()=>guardar(false);
async function guardar(sinFalta){
  if(!W||saving)return;
  if(operadores.length&&!operadores.includes(operador)&&editId==null){$('#savemsg').textContent='Elige tu nombre en «¿Quién captura?» antes de guardar.';return}
  const fa=sinFalta?[]:faltan();
  if(fa.length){faltaA=fa[0];$('#dft').textContent=`⚠ Falta capturar ${yLst(fa.map(a=>a+' cm'))}`;$('#dfgo').textContent=`Capturar ${fa[0]} cm`;$('#dfsk').textContent=`Guardar sin ${yLst(fa.map(a=>a+' cm'))}`;$('#dlgf').showModal();return}
  const se=sinElegir();if(se.length){$('#savemsg').textContent='Elige 1 o 2 cartones por caja en el cartón '+se.join(', ')+'.';return}
  const sm=W.lines.map((L,i)=>[L,i]).filter(([L])=>cambiado(L)&&capt(L)&&!L.m).map(([,i])=>i+1);
  if(sm.length){W.motErr=true;render();const c=$('#cap'+(sm[0]-1));if(c&&c.scrollIntoView)c.scrollIntoView({block:'center'});$('#savemsg').textContent='Elige por qué se cambió el cartón (cartón '+sm.join(', ')+').';return}
  const c=calc();
  if(!(c.R+(c.Rsp||0))){$('#savemsg').textContent='Captura al menos un cartón con largo y cajas antes de guardar.';return}
  const du=W.kind==='op'?dudas12(c.per):[];
  if(du.length){const t=du.map(a=>{const ls=W.lines.filter(L=>L.a===a&&num(L.l)>0);return`Cartón ${a} cm: `+ls.map(L=>`${L.n} caja(s) de ${L.l} cm con ${L.c==2?'2 cartones (tapa y fondo)':'1 cartón'}`).join(' + ')}).join('\n');
    if(!confirm('Revisa por favor:\n'+t+'\n\n¿Es correcto?'))return}
  saving=true;$('#save').disabled=true;$('#savemsg').textContent='Guardando…';
  try{
    const fresh=await DB.listReports(),old=editId!=null?fresh.find(r=>r.id===editId):null,ts=old?old.ts:Date.now();
    // semana = día de captura (la fecha de vencimiento de la OP se guarda aparte, para filtrar)
    const rep={id:old?old.id:null,ts,kind:W.kind,tipoOp:tipoReg(W),op:W.op||'—',modelo:W.modelo,
      tipoModelo:tipoModelo(W.modelo,W.desc),estadoERP:W.estado||'',semana:isoWeek(new Date(ts)),venc:W.kind==='op'?(W.fecha||''):'',cant:W.cant,
      ce:c.ce,cr:c.cr,E:c.E,R:c.R,Rsp:c.Rsp,diff:c.diff,dm:c.dm,abs:c.abs,mismo:c.mismo,fx:c.fx,st:c.st,est:c.est,com:(W.com||'').trim(),
      conf12:du.length?du:(old&&old.conf12)||null,rev:old?!!old.rev:false,...(old&&old.corr?{corr:old.corr}:{}),
      operador:old?(old.operador||''):(operador||''),version:old?W.ver:undefined,
      mcc:W.lines.filter(L=>cambiado(L)&&capt(L)&&L.m).map(L=>({de:+L.o,a:+L.a,m:L.m})),
      per:c.per.map(p=>({a:p.a,E:p.E,R:p.R,ce:p.ce,cr:p.cr,st:p.st,prog:p.prog,z:p.z,...(p.sp?{sp:true,spm:p.spm}:{})})),
      snap:{rows:[],lines:W.lines,com:W.com||''}};
    await DB.saveReport(rep);
    await reload();stat('');editId=null;
    $('#savemsg').innerHTML=`<b style="color:var(--ok)">✓ Guardado:</b> ${esc(rep.modelo)}${rep.op!=='—'?' · '+esc(rep.op):''}`;
    $('#work').classList.add('hide');W=null;misHoy();
  }catch(e){
    $('#savemsg').textContent=e&&(e.code==='conflict')?'⚠ '+e.message:e&&e.code==='auth'?'⚠ La sesión expiró: usa «Salir» y vuelve a iniciar sesión. La captura sigue en pantalla.':e&&e.code==='verify'?'⚠ El reporte no quedó en el almacenamiento del navegador. No cierres la página y avisa al administrador.':'⚠ NO se guardó el reporte. Inténtalo de nuevo; si sigue fallando, avisa al administrador.';
    dbErr(e);
  }finally{saving=false;$('#save').disabled=false}
}
$('#clear').onclick=()=>{if(!W)return;if(editId!=null){editId=null;W=null;$('#work').classList.add('hide');$('#savemsg').textContent='Edición cancelada: el registro quedó como estaba.';misHoy();return}
  const k=W.kind==='op'?W.op:W.modelo;editId=null;start(W.kind,k)};
// «Mis capturas de hoy»: solo para confirmar que se guardó (sin estados ni diferencias).
// Planta puede EDITAR sus propios registros del día (los de «Mis capturas de hoy»): si hay lista de operadores, solo los suyos.
// Se abre la misma captura con lo guardado; al guardar se reemplaza el registro (misma fecha de captura).
const editaHoy=r=>ymd(new Date(r.ts))===ymd(new Date())&&(r.kind!=='op'||!!cat[r.op])&&(!operadores.length||(!!operador&&r.operador===operador));
$('#hoy').addEventListener('click',async e=>{const id=e.target.dataset.edhoy;if(!id)return;
  if(W&&!confirm('Tienes una captura abierta. ¿Descartarla para editar este registro?'))return;
  await reload();const r=reports.find(x=>String(x.id)===id);if(!r||!editaHoy(r)){alert('Ese registro ya no se puede editar.');misHoy();return}
  $('#kind').value=r.kind;$('#kind').onchange();start(r.kind,r.kind==='op'?r.op:r.modelo,r);misHoy();
  $('#savemsg').innerHTML='<b>Editando un registro guardado.</b> Corrige lo necesario y da «Guardar». Si no quieres cambiar nada, da «Limpiar» y el registro queda como estaba.';
  const w=$('#work');if(w.scrollIntoView)w.scrollIntoView({block:'start'})});
function misHoy(){
  const hoy=ymd(new Date()),L=reports.filter(r=>ymd(new Date(r.ts))===hoy&&(!operador||!operadores.length||r.operador===operador)).sort((a,b)=>b.ts-a.ts);
  $('#hoy').innerHTML=`<h2>Mis capturas de hoy · ${new Date().toLocaleDateString('es-MX',{weekday:'long'})} ${fISO(hoy)} <span class="mut">(${L.length})</span></h2>`+(L.length?L.map(r=>`<div class="line"><span class="mut">${new Date(r.ts).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'})}</span>${editaHoy(r)?` <button class="btn ghost sm" type="button" data-edhoy="${r.id}">Editar</button>`:''} · <b>${esc(r.modelo)}</b> · ${r.kind==='op'?esc(r.op):esc(KINDS[r.kind])} · ${r.per.filter(p=>p.R>0).map(p=>`${p.a} cm × ${p.cr} caja(s)`).join(', ')}${editId!=null&&String(editId)===String(r.id)?' <span class="chip pend">Editando</span>':''}</div>`).join(''):'<p class="mut">Todavía no hay capturas hoy.</p>');
}

// Tablero, análisis y exportación  (ADMINISTRACIÓN = INFORMACIÓN ORDENADA)
const isA=r=>{const c=est(r).cls;return r.kind==='op'&&c!=='pend'&&c!=='err'};
const grp=(L,fn)=>{const m={};L.forEach(r=>fn(r).forEach(([k,e,rl,d])=>{const o=m[k]||(m[k]={k,E:0,R:0,P:0,N:0,n:0});o.E+=e;o.R+=rl;o.P+=Math.max(d,0);o.N+=Math.min(d,0);o.n++}));return Object.values(m).sort((a,b)=>(b.P-b.N)-(a.P-a.N))};
// Coincidencia de cartón de una OP: mismo cartón / cambio de cartón / caja extra
const COIN={mismo:'Mismo cartón',cambio:'Cambio de cartón',extra:'Caja Extra'};
const coin=r=>{const e=est(r),k=e.base||e.k;return k==='extra'?'extra':(k==='camb'||k==='cambcons')?'cambio':'mismo'};
function summ(L){
  const B=L.filter(isA),S=k=>B.reduce((s,r)=>s+r[k],0),G=f=>grp(B,f);
  const sn=L.filter(r=>r.kind!=='op'),SR=a=>a.reduce((t,r)=>t+r.R,0);
  // cruce semana × coincidencia
  const cx={};B.forEach(r=>{const w=cx[r.semana]||(cx[r.semana]={k:r.semana,n:0,ok:0,mismo:{n:0,E:0,R:0,A:0},cambio:{n:0,E:0,R:0,A:0},extra:{n:0,E:0,R:0,A:0},E:0,R:0,A:0});
    const c=w[coin(r)];c.n++;c.E+=r.E;c.R+=r.R;c.A+=Math.abs(r.diff);w.n++;w.E+=r.E;w.R+=r.R;w.A+=Math.abs(r.diff);if(est(r).cls==='ok')w.ok++});
  const tot={k:'Total',n:0,ok:0,E:0,R:0,A:0};['mismo','cambio','extra'].forEach(c=>tot[c]={n:0,E:0,R:0,A:0});
  Object.values(cx).forEach(w=>{['n','ok','E','R','A'].forEach(k=>tot[k]+=w[k]);['mismo','cambio','extra'].forEach(c=>['n','E','R','A'].forEach(k=>tot[c][k]+=w[c][k]))});
  return{B,inc:L.filter(r=>est(r).cls==='pend'),sn,incl:sn.filter(r=>r.kind==='inc'),ingr:sn.filter(r=>r.kind==='ing'),E:S('E'),R:S('R'),AC:S('abs'),
    ok:B.filter(r=>est(r).cls==='ok').length,
    Rsp:L.filter(r=>r.kind==='op').reduce((t,r)=>t+(r.Rsp||0),0),sp:L.filter(r=>r.kind==='op'&&est(r).k==='sinprog'),
    Rtot:SR(L.filter(r=>r.kind!=='op'||isA(r)))+L.filter(r=>r.kind==='op'&&isA(r)).reduce((t,r)=>t+(r.Rsp||0),0),Rinc:SR(sn.filter(r=>r.kind==='inc')),Ring:SR(sn.filter(r=>r.kind==='ing')),
    reg:grp(L.filter(r=>r.kind!=='op'||isA(r)),r=>[[KINDS[r.kind],r.kind==='op'?r.E:0,r.R,r.kind==='op'?r.diff:0]]),
    modInc:grp(sn.filter(r=>r.kind==='inc'),r=>[[r.modelo,0,r.R,0]]).sort((a,b)=>b.R-a.R),
    P:B.reduce((s,r)=>s+Math.max(r.diff,0),0),N:B.reduce((s,r)=>s+Math.min(r.diff,0),0),
    modelo:G(r=>[[r.modelo,r.E,r.R,r.diff]]),carton:G(r=>r.per.filter(p=>!p.sp).map(p=>[p.a+' cm',p.E,p.R,p.R-p.E])),clase:G(r=>[[clase(r.modelo),r.E,r.R,r.diff]]),
    tipoOp:G(r=>[[tipoReg(r),r.E,r.R,r.diff]]),semana:G(r=>[[r.semana,r.E,r.R,r.diff]]).sort((a,b)=>a.k<b.k?-1:1),
    cruce:Object.values(cx).sort((a,b)=>a.k<b.k?-1:1),cruceTot:tot};
}
const vencW=r=>r.venc?isoWeek(parseISO(r.venc)):'';
const opts=(sel,vals,todo)=>{const s=$(sel),v=s.value;s.innerHTML=`<option value="">${todo}</option>`+vals.map(x=>`<option${x===v?' selected':''}>${esc(x)}</option>`).join('')};
const vis=()=>reports.filter(r=>!(r.kind==='op'&&excluida(r.op)));
// OP doble consumo: una OP con más de un reporte. Se marcan los reportes posteriores al primero; quedan pendientes hasta «Revisada: válida».
let DBL=new Set();
function idxDobles(){DBL=new Set();const by={};vis().filter(r=>r.kind==='op').sort((a,b)=>a.ts-b.ts||String(a.id).localeCompare(String(b.id))).forEach(r=>{if(by[r.op])DBL.add(r.id);else by[r.op]=1})}
const esDoble=r=>DBL.has(r.id),doblePend=r=>esDoble(r)&&!r.rev;
function weeks(){const R=vis();
  opts('#fw',[...new Set(R.map(r=>r.semana))].sort().reverse(),'Todas');
  opts('#fv',[...new Set(R.map(vencW).filter(Boolean))].sort().reverse(),'Todas');
  opts('#fo',[...new Set(R.filter(r=>r.kind==='op').map(tipoReg))].sort(),'Todos')}
// Filtro de Estado: «con diferencia (todas)», cada estado de ESTADOS y la bandera de OP doble consumo.
const SF={bad:e=>e.cls==='bad',...Object.fromEntries(ESTADOS.map(x=>[x.k,e=>e.k===x.k]))};
$('#fs').innerHTML='<option value="">Todos</option><option value="bad">Con diferencia (todas)</option>'+ESTADOS.map(x=>`<option value="${x.k}">${esc(x.t)}</option>`).join('')+'<option value="doble">OP doble consumo (por revisar)</option><option value="pcorr">Pendientes de corregir</option>';
const FSEL=['#ff','#ft','#fw','#fv','#fk','#fo','#fc','#fs','#fq'];
const fAct=()=>FSEL.filter(x=>$(x).value.trim()).length;
const cnt=L=>{const a=fAct();return`${L.length} de ${vis().length} guardados`+(a?` <b style="color:var(--warn)">⚠ ${a} filtro${a>1?'s':''} activo${a>1?'s':''}</b>`:'')+(DB.repaired?` · <span style="color:var(--warn)">${DB.repaired} reparado${DB.repaired>1?'s':''} al leer</span>`:'')};
function filt(){
  idxDobles();
  const f=$('#ff').value,t=$('#ft').value,w=$('#fw').value,v=$('#fv').value,k=$('#fk').value,o=$('#fo').value,c=$('#fc').value,fs=$('#fs').value,sp=SF[fs],q=$('#fq').value.trim().toLowerCase();
  const dOps=fs==='doble'?new Set(vis().filter(doblePend).map(r=>r.op)):null;   // muestra TODOS los reportes de la OP para comparar
  return vis().filter(r=>{const d=ymd(new Date(r.ts));return(!f||d>=f)&&(!t||d<=t)&&(!w||r.semana===w)&&(!v||vencW(r)===v)&&(!k||r.kind===k)&&(!o||(r.kind==='op'&&tipoReg(r)===o))&&(!c||clase(r.modelo)===c)&&(!dOps||(r.kind==='op'&&dOps.has(r.op)))&&(fs!=='pcorr'||(porCorregir(r)&&!r.corr))&&(!sp||sp(est(r)))&&(!q||[r.modelo,r.op,tipoReg(r),modeloPrincipal(r.modelo)].join(' ').toLowerCase().includes(q))}).sort((a,b)=>b.ts-a.ts);
}
// Detalle del Tablero: consumo POR UNIDAD (mueble de la OP = Cant del ERP). Solo presenta; no cambia ningún cálculo.
const bul=(t,v)=>`<div class="line">• ${t}: <b>${v.replace(/ (m²|cm)/g,'&nbsp;$1')}</b></div>`,dh=t=>`<div class="dh">${t}</div>`;
function detail(r){
  const P=r.per||[],usa=P.filter(p=>p.R>0).map(p=>p.a+' cm').join(' + ')||'—';
  const com=r.com?`<div class="line">• Comentario: ${esc(r.com)}</div>`:'';
  if(r.kind!=='op'){const cj=r.cr||0;
    return dh('Cartón')+bul('Utilizado',usa)+dh('Por caja')+bul('Real',cj?fmt(r.R/cj)+' m²':'—')+com}
  const u=r.cant||1,prog=P.filter(pg).map(p=>p.a+' cm'+(p.z?' (0 m²)':'')).join(' + ')||'Sin cartón en el ERP';
  const C=P.filter(p=>!p.sp&&(pg(p)||p.R>0)),sp=r.Rsp||0;
  // Esperado ÷ unidades programadas (Cant); Real ÷ unidades realmente hechas (cajas capturadas convertidas a muebles
  // con la misma proporción cajas/mueble del ERP). Si se hicieron las mismas cajas que las programadas, uR = u.
  const S=f=>P.filter(f).reduce((s,p)=>s+(p.cr||0),0),cH=S(p=>!p.sp&&(pg(p)||p.R>0)),cS=S(p=>p.sp);
  const uR=r.ce?cH*u/r.ce:u,pr=(v,d)=>d>0?fmt(v/d):'—',m2=(v,d)=>d>0?fmt(v/d)+' m²':'—';
  let h=dh('Cartón')+bul('Programado',prog)+bul('Utilizado',usa)+dh('Por unidad');
  if(!C.length&&sp)h+=bul('Esperado','sin programar en el ERP')+bul('Real',m2(sp,cS||u));
  else{h+=bul('Esperado',fmt(r.E/u)+' m²')+bul('Real',m2(r.R,uR))+bul('Diferencia',uR>0?sgm(r.R/uR-r.E/u)+' m²':'—');
    if(C.length>1)h+=C.map(p=>`<div class="line mut">&nbsp;&nbsp;${p.a}&nbsp;cm: ${fmt(p.E/u)} → ${pr(p.R,uR)} (${uR>0?sgm(p.R/uR-p.E/u):'—'})</div>`).join('');
    if(sp)h+=`<div class="line c-sinprog">• Sin programar: <b>+${m2(sp,uR||u).replace(' m²','&nbsp;m²')}</b></div>`}
  const mt=motTxt(r);if(mt)h+=`<div class="line">• Motivo del cambio: <b>${esc(mt)}</b></div>`;
  return h+com;
}
// Programación del ERP para el Excel: cartones en 0 m² y OP sin cartón.
const progTxt=r=>{const z=r.per.filter(p=>p.z).map(p=>p.a+' cm en 0 m²');if(r.kind==='op'&&!r.per.some(pg))return'OP sin cartón en el ERP';return z.join(', ')};
// Cajas (dato informativo): las de los cartones programados contra Cant; las de cartón no programado aparte como «extra».
function cajasTxt(r){const P=r.per||[],S=f=>P.filter(f).reduce((s,p)=>s+p.cr,0),cE=S(p=>pg(p)&&!p.sp),cX=S(p=>!pg(p)&&p.R>0&&!p.sp),cS=S(p=>p.sp);
  const sp=cS?` <span class="c-sinprog">+ ${cS} sin programar</span>`:'';
  if(!P.some(pg))return`${cS||r.cr} <span class="c-sinprog">(sin programar)</span>`;
  if(cX&&coin(r)==='cambio')return r.ce+' → '+(cE+cX)+' <span class="mut">(cambio de cartón)</span>'+sp;
  return r.ce+' → '+cE+(cX?` <b>+ ${cX} extra</b>`:'')+sp}
let cur=1,lim=100;const refresh=()=>cur===3?analysis():cur===4?modelosView():board();
// «Corregido» (marca de administración en el Tablero, columna visible solo con Detalle): para registros que no son
// «Correcto». No cambia estados ni indicadores; solo reduce las alertas pendientes (sección 3) y alimenta el filtro.
const porCorregir=r=>{const c=est(r).cls;return c==='bad'||c==='pend'};
function celdaCorr(r){if(!porCorregir(r))return'';
  if(r.corr)return`<span class="chip ok">✓ Corregido</span><br><span class="mut">${esc(r.corr.por||'')} · ${dmy(r.corr.ts)}</span><br><a href="#" class="adm w" data-uncorr="${r.id}">Deshacer</a>`;
  return`<button class="btn ghost sm adm w" data-corr="${r.id}" type="button">Marcar corregido</button>`}
// Columna «Cartón»: un cartón por línea (alineado con los m² de cada cartón). En naranja el usado que no era el
// programado; en morado el sin programar. El cambio de cartón (programado → usado) se ve en el estado y en el Detalle.
function colCarton(r){
  const P=r.kind==='op'?porCarton(r):(r.per||[]).filter(p=>p.R>0);if(!P.length)return'—';
  return P.map(p=>`<div class="pl${p.sp?' c-sinprog':r.kind==='op'&&!pg(p)?' c-otro':''}">${p.a}&nbsp;cm${p.z?' <span class="np">(0 m²)</span>':''}</div>`).join('')}
// OP con 2 o más cartones: una línea por cartón dentro de las mismas columnas (esperado, real, diferencia de CADA cartón).
// Sin total ni iconos; solo el cartón con mayor diferencia fuera de tolerancia va en negritas y color. Solo presentación.
const porCarton=r=>(r.per||[]).filter(p=>pg(p)||p.R>0);
function celdasCarton(r){const P=porCarton(r);
  const cand=P.filter(p=>pg(p)&&p.E>0&&p.R>0&&!p.sp&&Math.abs((p.R-p.E)/p.E*100)>tolv);
  const top=cand.reduce((a,p)=>!a||Math.abs(p.R-p.E)>Math.abs(a.R-a.E)?p:a,null);
  const L=(p,v)=>`<div class="pl${p.sp?' c-sinprog':''}">${v}</div>`;
  const e=P.map(p=>L(p,pg(p)?fmt(p.E):'—')).join('');
  const re=P.map(p=>L(p,p.R>0?fmt(p.R):'—')).join('');
  const d=P.map(p=>L(p,p.sp?'<span class="np">sin programar</span>':!pg(p)?'<span class="np">no programado</span>':!(p.R>0)?'<span class="np">no usado</span>':
    p===top?`<b class="${p.R>p.E?'pos':'neg'}">${sgm(p.R-p.E)}</b>`:sgm(p.R-p.E))).join('');
  return`<td class="n">${e}</td><td class="n">${re}</td><td class="n">${d}</td>`}
// Fila del Tablero (8 · detalle): estado junto al modelo, m² en columnas separadas, borde y cartón distinto con el color del estado.
const fueraTol=r=>r.E&&Math.abs((r.R-r.E)/r.E*100)>tolv;
function row(r){const e=est(r),op=r.kind==='op',was=r.est&&r.est!==e.t?`<br><span class="mut">Al guardar: ${esc(r.est)}</span>`:'';
  const dbl=esDoble(r)?(r.rev?'<br><span class="chip na">OP doble consumo · revisada</span>':`<br><span class="chip bad">OP doble consumo · requiere revisión</span> <button class="btn ghost sm adm w" data-rev="${r.id}" type="button">Revisada: válida</button>`):'';
  return`<tr class="r-${e.k}"><td>${new Date(r.ts).toLocaleString('es-MX',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'})}<br><span class="mut">Sem. ${esc(r.semana)}</span>${r.operador?`<br><span class="mut">${esc(r.operador)}</span>`:''}</td>
  <td><b>${esc(r.modelo)}</b><br><span class="mut">${esc(r.op)} · ${esc(tipoReg(r))} · ${clase(r.modelo)}</span>${op&&opDesconocida(r.op)?' <span class="chip pend">revisar tipo de OP</span>':''}${op&&r.venc?`<br><small class="fp">Programa ${fISO(r.venc)}</small>`:''}</td>
  <td>${chipE(e)}${e.c&&e.c!=='—'?`<br><span class="mut">${esc(e.c)}</span>`:''}${was}${dbl}${e.k==='sinprog'?'<br>'+segChip(r.modelo)+` <button class="btn ghost sm adm w" data-seg="${esc(r.modelo)}" type="button">Seguimiento</button>`:''}</td>
  <td>${colCarton(r)}</td>
  ${op&&porCarton(r).length>1?celdasCarton(r):`<td class="n">${op?fmt(r.E):'—'}</td><td class="n">${fmt(r.R+(r.Rsp||0))}</td><td class="n">${op?(fueraTol(r)?'<b>'+sgm(r.diff)+'</b>':sgm(r.diff)):'—'}${r.Rsp?`<br><span class="c-sinprog">+${fmt(r.Rsp)} sin programar</span>`:''}</td>`}
  <td>${op?cajasTxt(r):r.cr}</td><td class="det ccor">${celdaCorr(r)}</td><td class="det">${detail(r)}</td>
  <td class="adm"><span class="w"><button class="btn ghost sm" data-ed="${r.id}">Corregir</button> <button class="btn ghost sm" data-del="${r.id}">Borrar</button></span></td></tr>`}
// Leyenda: punto de color + nombre corto + cuántos hay con los filtros actuales. Clic = filtrar por ese estado (otro clic lo quita).
function leyenda(L){const n={};L.forEach(r=>{const k=est(r).k;n[k]=(n[k]||0)+1});const f=$('#fs').value;
  $('#leg').innerHTML=ESTADOS.map(x=>`<button type="button" data-st="${x.k}" title="${esc(x.t+': '+x.d)}"${f===x.k?' class="on"':''}><i class="c-${x.k}" style="${x.k==='pend'?'border:1.5px solid currentColor':'background:currentColor'}"></i>${esc(x.s)} <b>${n[x.k]||0}</b></button>`).join('')}
$('#leg').onclick=e=>{const b=e.target.closest('[data-st]');if(!b)return;const k=b.dataset.st;$('#fs').value=$('#fs').value===k?'':k;lim=100;board()};
function board(){
  weeks();const L=filt();$('#more').classList.toggle('hide',L.length<=lim);$('#more').textContent='Mostrar más ('+Math.max(0,L.length-lim)+' restantes)';$('#dtable').classList.toggle('nodet',!$('#ddet').checked);
  const n=x=>L.filter(r=>est(r).cls===x).length,nd=L.filter(doblePend).length;
  // los conteos por estado están en la leyenda; aquí solo el total, filtros y lo que requiere atención
  leyenda(L);
  $('#dsum').innerHTML=`${cnt(L)}`+(nd?` · <a href="#" id="vdoble" style="color:var(--bad);font-weight:700" title="Ver solo esas OP, incluida su primera captura">${nd} OP doble consumo por revisar</a>`:'')+(n('err')?` · <b style="color:var(--bad)">${n('err')} ilegibles</b>`:'')+(L.length>lim?` · mostrando los primeros ${lim}`:'');
  $('#dbody').innerHTML=L.length?L.slice(0,lim).map(r=>{try{return row(r)}catch(x){return`<tr class="r-err"><td colspan="10" style="color:var(--bad)">⚠ Registro ilegible (id ${esc(r.id)}): ${esc(x.message)}</td><td class="adm"><button class="btn ghost sm w" data-del="${r.id}">Borrar</button></td></tr>`}}).join(''):`<tr><td colspan="11" class="mut">${reports.length&&fAct()?'Hay '+reports.length+' reporte(s) guardado(s), pero los filtros activos los ocultan. Usa «Limpiar filtros».':'No hay registros guardados.'}</td></tr>`;
}
const hbars=a=>{const mx=Math.max(0.001,...a.map(x=>Math.max(x.P,-x.N)));return a.map(x=>`<div class="hb"><span title="${esc(x.k)}">${esc(x.k)}</span><div class="tr"><div class="l"><i class="nb" style="width:${-x.N/mx*100}%"></i></div><div class="r"><i class="pb" style="width:${x.P/mx*100}%"></i></div></div><span><b>${sgm(x.R-x.E)} m²</b> · ${pct(x.R,x.E)}<br><span class="mut">abs ${fmt(x.P-x.N)} · ${x.n} reg.</span></span></div>`).join('')||'<p class="mut">Sin datos.</p>'};
const gbars=a=>{const mx=Math.max(0.001,...a.map(x=>Math.max(x.E,x.R)));return'<div class="gb">'+a.map(x=>`<div><div class="pr"><i class="e" style="height:${x.E/mx*100}%"></i><i class="re" style="height:${x.R/mx*100}%"></i></div>${esc(x.k)}<br>${fmt(x.E)} / ${fmt(x.R)}<br><span class="mut">${pct(x.R,x.E)}</span></div>`).join('')+'</div>'};
const K=(t,v,c,sub)=>`<div class="kpi"><span class="mut">${t}</span><b class="${c||''}">${v}</b>${sub?`<span class="mut">${sub}</span>`:''}</div>`;
const SEC=(n,t,body,id)=>`<section class="card sec"${id?` id="${id}"`:''}><h2><span class="sn">${n}</span> ${t}</h2>${body}</section>`;
// Alertas importantes (sección 3): cada una lleva directo a donde se revisa.
function alertas(L,s,M){
  const A=[],nd=L.filter(doblePend),ops=new Set(nd.map(r=>r.op));
  const SG=segModelos(L),ab=SG.filter(g=>g.estado!=='corr'),ce=SG.filter(g=>g.estado==='corr');
  if(ab.length){const n=ab.reduce((t,g)=>t+g.n,0),m=ab.reduce((t,g)=>t+g.R,0);
    A.push(['st-sinprog',`<b>${n} OP de ${ab.length} modelo(s) consumieron ${fmt(m)} m² de cartón sin programar en el ERP</b> (revisar en Dynamics):`+
      ab.slice(0,8).map(g=>`<span class="sgl"><b>${esc(g.modelo)}</b> · ${g.n} OP · ${fmt(g.R)} m² · ${segChip(g.modelo)} <button class="btn ghost sm w" type="button" data-seg="${esc(g.modelo)}">Seguimiento</button></span>`).join('')+(ab.length>8?`<span class="sgl mut">y ${ab.length-8} modelo(s) más</span>`:''),'2|sinprog'])}
  if(ce.length)A.push(['st-ok',`✓ ${ce.length} modelo(s) con consumo sin programar ya <b>corregidos en origen</b>: ${ce.slice(0,6).map(g=>esc(g.modelo)).join(', ')}.`,'']);
  if(nd.length)A.push(['st-cambcons',`<b>${ops.size} OP con doble consumo</b> por revisar (${nd.length} captura(s) adicional(es)).`,'2|doble']);
  // (pestaña Modelos oculta desde v5.12: la alerta de variantes fuera del patrón ya no se muestra porque no hay a dónde llevarla)
  // Lo marcado «Corregido» en el Tablero ya no cuenta como pendiente: la alerta muestra lo que falta y cuántos ya se corrigieron.
  const nk=k=>s.B.filter(r=>est(r).k===k);
  const alC=(cls,L,txt,cola,go)=>{if(!L.length)return;const p=L.filter(r=>!r.corr).length,c=L.length-p;
    if(p)A.push([cls,`<b>${txt(p)}</b>${cola}`+(c?` <span class="mut">(${c} ya ${c>1?'corregidos':'corregido'})</span>`:''),go]);
    else A.push(['st-ok',`✓ ${txt(L.length)}: ${L.length>1?'todos corregidos':'corregido'}.`,''])};
  alC('st-cambcons',nk('cambcons'),n=>`${n} OP con cambio de cartón y diferencia de consumo`,'.','2|cambcons');
  alC('st-extra',nk('extra'),n=>`${n} OP con Caja Extra`,'.','2|extra');
  alC('st-camb',nk('camb'),n=>`${n} OP con cambio de cartón`,' (m² dentro de tolerancia).','2|camb');
  alC('st-pend',s.inc,n=>`${n} registro(s) incompleto(s)`,': falta capturar un cartón programado.','2|pend');
  const ot=L.filter(r=>r.kind==='op'&&opDesconocida(r.op)).length;if(ot)A.push(['st-pend',`<b>${ot} registro(s) con tipo de OP no reconocido.</b>`,'2|q:otro (']);
  const cf=L.filter(r=>r.conf12).length;if(cf)A.push(['st-sinop',`${cf} captura(s) donde el operador confirmó 1 o 2 cartones con un resultado cercano al doble o a la mitad.`,'']);
  return A;
}
/* ==== SEGUIMIENTO «SIN PROGRAMAR» (por modelo) ====
   La app NO corrige la programación: Dynamics es la única fuente. Aquí solo se registra el seguimiento:
   Pendiente (automático) → Reportado a Dynamics (admin, con comentario) → Corregido en origen
   (automático cuando llega una OP nueva del modelo con su cartón programado en m², o manual). Se guarda en cfg.seguimiento.
   Si después de «Corregido» vuelve a aparecer consumo sin programar del modelo, se reabre. */
const SEG={pend:'Pendiente',rep:'Reportado a Dynamics',corr:'Corregido en origen'};
function segEstado(modelo,ult){const g=cfg.seguimiento[modelo]||{};if(!g.estado)return'pend';if(g.estado==='corr'&&ult>(g.ts||0))return'pend';return g.estado}
function segModelos(L){const G={};
  L.filter(r=>r.kind==='op'&&est(r).k==='sinprog').forEach(r=>{const g=G[r.modelo]||(G[r.modelo]={modelo:r.modelo,ops:new Set(),R:0,ult:0});g.ops.add(r.op);g.R+=r.Rsp||0;g.ult=Math.max(g.ult,r.ts)});
  return Object.values(G).map(g=>({...g,n:g.ops.size,estado:segEstado(g.modelo,g.ult)})).sort((a,b)=>b.R-a.R)}
function segChip(modelo){const ult=Math.max(0,...vis().filter(r=>r.modelo===modelo&&r.kind==='op'&&est(r).k==='sinprog').map(r=>r.ts)),e=segEstado(modelo,ult),g=cfg.seguimiento[modelo]||{};
  const reab=g.estado==='corr'&&e==='pend';
  return`<span class="chip st st-${e==='corr'?'ok':e==='rep'?'camb':'sinprog'}" title="${esc((g.com||'')+(g.por?' — '+g.por+' '+dmy(g.ts):''))}">${SEG[e]}${reab?' (reabierto)':''}${e==='corr'&&g.auto?' ✓':''}</span>`}
const quien=()=>sesion?(sesion.nombre||sesion.email):'Administración (local)';
async function guardarSeg(modelo,nuevo){   // relee antes de escribir para no pisar el seguimiento de otro modelo
  const st=await DB.getSettings(),sg={...(st.seguimiento||{})},prev=sg[modelo]||{};
  sg[modelo]={...nuevo,hist:[...(prev.hist||[]),{estado:nuevo.estado,com:nuevo.com||'',por:nuevo.por,ts:nuevo.ts,auto:!!nuevo.auto}].slice(-20)};
  await DB.saveSettings({seguimiento:sg});cfg.seguimiento=sg}
let segModelo=null;
document.addEventListener('click',e=>{const b=e.target.closest('[data-seg]');if(!b)return;segModelo=b.dataset.seg;
  const g=cfg.seguimiento[segModelo]||{},L=vis().filter(r=>r.modelo===segModelo&&r.kind==='op'&&est(r).k==='sinprog');
  $('#sgm').textContent=segModelo;$('#sgi').innerHTML=`${new Set(L.map(r=>r.op)).size} OP con consumo sin programar (${fmt(L.reduce((t,r)=>t+(r.Rsp||0),0))} m²): ${esc([...new Set(L.map(r=>r.op))].slice(0,8).join(', '))}`+
    (g.hist&&g.hist.length?'<br>'+g.hist.slice(-3).map(h=>`${dmy(h.ts)} · ${esc(SEG[h.estado])} · ${esc(h.por)}${h.com?' — '+esc(h.com):''}`).join('<br>'):'');
  $('#sge').value=segEstado(segModelo,Math.max(0,...L.map(r=>r.ts)));$('#sgc').value='';$('#dlgs').showModal()});
$('#sgno').onclick=()=>$('#dlgs').close();
$('#sgok').onclick=async()=>{const m=segModelo;if(!m)return;
  try{await guardarSeg(m,{estado:$('#sge').value,com:$('#sgc').value.trim(),por:quien(),ts:Date.now(),auto:false})}catch(x){dbErr(x,'No se pudo guardar el seguimiento');return}
  $('#dlgs').close();refresh()};
// Al cargar el Excel: un modelo con consumo sin programar se da por «Corregido en origen» si llega una OP NUEVA de ese
// modelo con todos sus cartones programados en m².
async function verificarCorrecciones(m){
  await reload();const SG=segModelos(vis()).filter(g=>g.estado!=='corr'),ok=[];
  for(const g of SG){const o=Object.values(m).find(x=>x.modelo===g.modelo&&!g.ops.has(x.op)&&x.rows.length&&x.rows.every(r=>r.val>0));
    if(o){await guardarSeg(g.modelo,{estado:'corr',auto:true,verif:o.op,com:`Llegó ${o.op} con su cartón programado en el ERP`,por:'Automático (carga del Excel)',ts:Date.now()});ok.push(`${g.modelo} (${o.op})`)}}
  return ok}
// ==== Resumen ejecutivo ====
// Viñetas ✓ (bien) / ⚠ (atención). Cada regla es independiente: agregar o quitar una conclusión = una línea aquí.
const dmy=t=>{const d=new Date(t);return p2(d.getDate())+'/'+p2(d.getMonth()+1)+'/'+d.getFullYear()};
function periodoTxt(L){if(!L.length)return'';const t=L.map(r=>r.ts),a=dmy(Math.min(...t)),b=dmy(Math.max(...t));return a===b?`El ${a}`:`Del ${a} al ${b}`}
function resumenEjecutivo(L,s,M,A,net,abs){
  const ok=t=>['ok',t],at=t=>['at',t],I=[],n=s.B.length,sinop=s.sn.length;
  const pl=(x,u,v)=>x===1?u:v;
  I.push(['in',`${periodoTxt(L)} se registraron <b>${n} OP</b>`+(sinop?` y <b>${sinop}</b> ${pl(sinop,'consumo','consumos')} sin OP (inclusiones o ingeniería)`:'')+'.']);
  // consumo sin programar en el ERP (lo más importante: error de programación en Dynamics)
  const SG=segModelos(L).filter(g=>g.estado!=='corr');
  if(SG.length)I.push(at(`<b>${SG.reduce((t,g)=>t+g.n,0)} OP</b> (${SG.length} ${pl(SG.length,'modelo','modelos')}) consumieron <b>${fmt(SG.reduce((t,g)=>t+g.R,0))} m²</b> de cartón <b>sin programar</b> en el ERP: revisar en Dynamics.`));
  if(!n){I.push(['in','No hay OP completas para comparar contra lo esperado.']);return lista(I)}
  // situación general: tolerancia de consumo por OP
  const fT=s.B.filter(fueraTol).length;
  I.push(fT?at(`<b>${fT} de ${n} OP</b> ${pl(fT,'quedó','quedaron')} fuera de la tolerancia de consumo (±${tolv} %).`):ok(n===1?'La OP quedó dentro de la tolerancia de consumo.':'Todas las OP quedaron dentro de la tolerancia de consumo.'));
  // cartón: cambios y cajas extra
  const cb=s.B.filter(r=>coin(r)==='cambio').length,ex=s.B.filter(r=>coin(r)==='extra').length;
  I.push(cb||ex?at([cb?`<b>${cb}</b> ${pl(cb,'cambio','cambios')} de cartón`:'',ex?`<b>${ex}</b> ${pl(ex,'OP','OP')} con Caja Extra`:''].filter(Boolean).join(' y ')+'.'):ok('No se detectaron cambios de cartón ni cajas extra.'));
  // consumo total y compensación
  const v=vp(s.R,s.E),ap=s.E?abs/s.E*100:0;
  if(v!=null&&Math.abs(v)>tolv)I.push(at(`El consumo real está <b>${Math.abs(v).toFixed(1)} % ${v>0?'por encima':'por debajo'}</b> del esperado.`));
  else if(ap>tolv)I.push(at(`El total parece alineado, pero <b>las diferencias se compensan entre OP</b>: hay ${fmt(abs)} m² de diferencia absoluta (${ap.toFixed(1)} % del esperado).`));
  else I.push(ok('El consumo real se mantuvo alineado con el esperado.'));
  // alertas pendientes (las informativas no cuentan)
  const pend=A.filter(a=>a[2]).length;
  I.push(pend?at(`Hay <b>${pend} ${pl(pend,'alerta pendiente','alertas pendientes')}</b> de revisión.`):ok('Sin alertas pendientes.'));
  // cartones que requieren atención: consumo fuera de tolerancia EN el cartón programado (sin contar cambios de cartón,
  // que ya se reportan arriba y distorsionarían el % de ambos anchos)
  const cr=grp(s.B.filter(r=>coin(r)!=='cambio'),r=>r.per.filter(p=>p.E&&p.R).map(p=>[p.a+' cm',p.E,p.R,p.R-p.E])).filter(c=>c.E&&Math.abs((c.R-c.E)/c.E*100)>tolv);
  if(cr.length)I.push(at(`${pl(cr.length,'Cartón','Cartones')} que ${pl(cr.length,'requiere','requieren')} atención: `+cr.slice(0,3).map(c=>`<b>${esc(c.k)}</b> (${pct(c.R,c.E)})`).join(', ')+'.'));
  return lista(I);
}
// ==== 5 · Por día de la semana ====  Día = fecha de captura (igual que la semana). Lunes a viernes siempre;
// sábado y domingo solo si hubo capturas. Solo OP del comparativo (mismo universo que la sección 4).
const DIAS=['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
function lunesDe(w){const m=String(w).match(/^(\d{4})-S(\d\d)$/);if(!m)return null;const y=+m[1],j=new Date(y,0,4),l=new Date(y,0,4-((j.getDay()+6)%7));l.setDate(l.getDate()+(+m[2]-1)*7);return l}
const semTxt=w=>{const l=lunesDe(w);if(!l)return w;const v=new Date(l);v.setDate(v.getDate()+4);return`${w.replace(/^\d{4}-/,'')} · ${dmy(l)} – ${dmy(v)}`};
let diaSem='';
function porDia(B){
  const ws=[...new Set(B.map(r=>r.semana))].sort().reverse();if(!ws.length)return'';
  if(!ws.includes(diaSem))diaSem=ws[0];
  const l=lunesDe(diaSem),Rw=B.filter(r=>r.semana===diaSem),D=[];
  for(let i=0;i<7;i++){const d=new Date(l);d.setDate(l.getDate()+i);const k=ymd(d),rs=Rw.filter(r=>ymd(new Date(r.ts))===k);
    if(i>=5&&!rs.length)continue;
    D.push({k:DIAS[d.getDay()],f:dmy(d).slice(0,5),n:rs.length,ft:rs.filter(fueraTol).length,cb:rs.filter(r=>coin(r)==='cambio').length,ex:rs.filter(r=>coin(r)==='extra').length,
      net:rs.reduce((t,r)=>t+r.diff,0),abs:rs.reduce((t,r)=>t+Math.abs(r.diff),0)})}
  const T=D.reduce((t,x)=>t+x.abs,0),CB=D.reduce((t,x)=>t+x.cb,0),mx=D.reduce((a,x)=>x.abs>a.abs?x:a,D[0]),mxA=Math.max(0.001,...D.map(x=>x.abs));
  const top=T>0?mx:null,dl=x=>x.k.toLowerCase();
  let con;
  if(!top)con='Sin diferencias de consumo en esta semana.';
  else{con=`El <b>${dl(top)}</b> concentró la mayor diferencia (${fmt(top.abs)} m², ${(top.abs/T*100).toFixed(0)} % de la semana)`;
    const mc=D.reduce((a,x)=>x.cb>a.cb?x:a,D[0]);
    if(CB&&top.cb)con+=` y ${top.cb} de los ${CB} cambios de cartón`;else if(CB)con+=`; más cambios de cartón: ${dl(mc)} (${mc.cb} de ${CB})`;con+='.'}
  const sel=`<label class="mut" style="max-width:340px">Semana<select id="dsem">${ws.map(w=>`<option value="${esc(w)}"${w===diaSem?' selected':''}>${esc(semTxt(w))}</option>`).join('')}</select></label>`;
  const bars='<div class="gb">'+D.map(x=>`<div class="${top&&x===top?'mx':''}"><div class="pr"><i class="d" style="height:${x.abs/mxA*100}%"></i></div>${x.k}<br><span class="mut">${x.f}</span><br>${fmt(x.abs)} m²</div>`).join('')+'</div>';
  const tb=`<div class="scroll"><table class="tc"><thead><tr><th>Día</th><th>OP</th><th>Fuera de tolerancia</th><th>Cambios de cartón</th><th>Caja Extra</th><th>Dif. neta (m²)</th><th>Dif. absoluta (m²)</th></tr></thead><tbody>${
    D.map(x=>{const b=v=>top&&x===top?`<b>${v}</b>`:v;return`<tr><td>${b(x.k+' '+x.f)}</td><td>${x.n}</td><td>${x.ft}</td><td>${x.cb}</td><td>${x.ex}</td><td>${b(x.n?sgm(x.net):'—')}</td><td>${b(x.n?fmt(x.abs):'—')}</td></tr>`}).join('')}</tbody></table></div>`;
  return`${sel}<p style="margin:10px 0">${con}</p><p class="mut"><i class="sw" style="background:var(--warn)"></i> Diferencia absoluta del día (m²)</p>${bars}${tb}
    <p class="mut">Día = fecha de captura. Solo OP del comparativo (sin incompletos ni consumos sin OP).</p>`;
}
// ==== Motivo de los cambios de cartón (al final del Análisis): no cambia ningún indicador ====
function motivosCambio(B){
  const C=B.filter(r=>coin(r)==='cambio');if(!C.length)return'';
  const n={},col={exist:'var(--s-camb,#b4540a)',inc:'var(--bad)',sin:'var(--line)'};
  C.forEach(r=>{const m=(r.mcc&&r.mcc[0]&&r.mcc[0].m)||'sin';n[m]=(n[m]||0)+1});
  const it=[...Object.keys(MOTIVOS),'sin'].filter(k=>n[k]).map(k=>({k,t:k==='sin'?'Sin motivo registrado':MOTIVOS[k],n:n[k],p:n[k]/C.length*100}));
  return`<section class="card sec"><h2>Motivo de los cambios de cartón <span class="mut" style="font-weight:400">(${C.length} ${C.length===1?'cambio':'cambios'})</span></h2>
    <div class="mtb">${it.map(x=>`<i style="width:${x.p}%;background:${col[x.k]||'var(--acc)'}" title="${esc(x.t)}"></i>`).join('')}</div>
    ${it.map(x=>`<div class="line"><i class="sw" style="background:${col[x.k]||'var(--acc)'}"></i> ${esc(x.t)}: <b>${x.n} (${x.p.toFixed(0)} %)</b></div>`).join('')}</section>`;
}
const lista=I=>'<ul class="rx">'+I.map(([k,t])=>`<li class="rx-${k}">${t}</li>`).join('')+'</ul>';
let resSem='';
$('#ana').addEventListener('change',e=>{if(e.target.id==='ressem'){resSem=e.target.value;analysis()}});
function analysis(){
  weeks();const L=filt(),s=summ(L),M=modelosCalc(L),net=s.P+s.N,abs=s.P-s.N,comp=abs?(abs-Math.abs(net))/abs*100:0;
  $('#dsum').innerHTML=`${cnt(L)}: ${s.B.length} OP analizadas · ${s.inc.length} incompletos · ${s.incl.length} inclusiones · ${s.ingr.length} de ingeniería`;
  if(!s.B.length&&!s.sn.length){$('#ana').innerHTML='<div class="card mut">No hay registros con estos filtros para analizar.</div>';return}
  const lg1='<p class="mut"><i class="sw e"></i> Esperado &nbsp;<i class="sw re"></i> Real</p>',lg2='<p class="mut"><i class="sw nb"></i> Consumió de menos &nbsp;<i class="sw pb"></i> Consumió de más</p>';
  const A0=alertas(L,s,M),AS=alertasSeparar(A0,1),A=AS.vis,okp=s.B.length?s.ok/s.B.length*100:0;   // A = alertas no descartadas
  // 1 · Resumen ejecutivo: conclusión automática (no repite los indicadores); solo situación general, alertas,
  //     modelos y cartones que requieren atención y desviaciones relevantes. Ver resumenEjecutivo().
  // 1 · Resumen ejecutivo POR SEMANA (semana de registro; por defecto la más reciente del periodo filtrado)
  const SW=[...new Set(L.map(r=>r.semana).filter(Boolean))].sort().reverse();if(!SW.includes(resSem))resSem=SW[0]||'';
  const Lw=L.filter(r=>r.semana===resSem),sw=summ(Lw),Mw=modelosCalc(Lw),Aw=alertasSeparar(alertas(Lw,sw,Mw),1).vis;
  const r1=`<div class="row" style="margin-bottom:6px"><label style="flex:0 1 280px">Semana<select id="ressem">${SW.map(w=>`<option value="${w}"${w===resSem?' selected':''}>${esc(semTxt(w))}</option>`).join('')}</select></label></div>`+
    resumenEjecutivo(Lw,sw,Mw,Aw,sw.P+sw.N,sw.P-sw.N);
  // 2 · Indicadores
  const r2=`<div class="kpis">${K('Consumo esperado',fmt(s.E)+' m²')}${K('Consumo real',fmt(s.R)+' m²')}${K('Diferencia neta',sgm(net)+' m²','',pct(s.R,s.E))}${K('Diferencia absoluta',fmt(abs)+' m²')}${K('OP correctas',fmt(okp)+' %','',`${s.ok} de ${s.B.length}`)}</div>
    <h3>¿Se compensan los consumos de más y de menos?</h3>
    <div class="kpis">${K('De más',sgm(s.P)+' m²','pos')}${K('De menos',sgm(s.N)+' m²','neg')}${K('% compensado',fmt(comp)+' %')}${K('Absoluta por cartón',fmt(s.AC)+' m²')}</div>
    <p class="mut">Neta cercana a 0 con absoluta alta = unas OP compensan a otras; no es buen desempeño. «Absoluta por cartón» detecta además compensación dentro de una misma OP.</p>
    <h3>Consumo fuera del comparativo</h3>
    <div class="kpis">${K('Sin programar en ERP',fmt(s.Rsp)+' m²',s.Rsp?'c-sinprog':'',`${s.sp.length} OP · ${new Set(s.sp.map(r=>r.modelo)).size} modelo(s)`)}${K('Inclusiones',fmt(s.Rinc)+' m²','',s.incl.length+' reg.')}${K('Caja de Ingeniería',fmt(s.Ring)+' m²','',s.ingr.length+' reg.')}${K('Consumo real total',fmt(s.Rtot)+' m²','','comparable + fuera del comparativo')}</div>
    <p class="mut">No tienen m² esperados: suman al consumo real, no a las diferencias ni a la compensación. Excluidos del comparativo: ${s.inc.length} incompleto(s).</p>`;
  // 3 · Alertas
  const r3=(A.length?A.map(([c,t,go])=>`<div class="al ${c}"><span>${t}</span><span class="alb">${go?`<button class="btn ghost sm" type="button" data-go="${esc(go)}">Ver</button>`:''}${aloBtn(t)}</span></div>`).join(''):`<p class="mut">${AS.ocu.length?'Sin alertas pendientes.':'Sin alertas con estos filtros.'}</p>`)+aloRest(AS.ocu,1);
  // 4 · Esperado vs real + cruce semana × coincidencia
  const T=s.cruceTot,celda=c=>c.n?`${c.n} · <b>${sgm(c.R-c.E)}</b> <span class="mut">${pct(c.R,c.E)}</span>`:'<span class="mut">—</span>';
  const fila=w=>`<tr><td><b>${esc(w.k)}</b></td><td>${w.n}</td><td>${w.ok}</td><td>${celda(w.mismo)}</td><td>${celda(w.cambio)}</td><td>${celda(w.extra)}</td><td><b>${sgm(w.R-w.E)}</b> <span class="mut">${pct(w.R,w.E)}</span></td></tr>`;
  const sh=c=>T.A?fmt(T[c].A/T.A*100)+' %':'—';
  const r4=`${lg1}${gbars(s.semana)}
    <h3>Semana × coincidencia de cartón</h3>
    <div class="kpis">${K('Mismo cartón',T.mismo.n+' OP','',`${sh('mismo')} de la diferencia absoluta`)}${K('Cambio de cartón',T.cambio.n+' OP','',`${sh('cambio')} de la diferencia absoluta`)}${K('Caja Extra',T.extra.n+' OP','',`${sh('extra')} de la diferencia absoluta`)}</div>
    <div class="scroll"><table class="tc"><thead><tr><th>Semana</th><th>OP</th><th>Correctas</th><th><span class="chip st st-ok">Mismo cartón</span><br><span class="mut">OP · dif m² · %</span></th><th><span class="chip st st-camb">Cambio de cartón</span><br><span class="mut">OP · dif m² · %</span></th><th><span class="chip st st-extra">Caja Extra</span><br><span class="mut">OP · dif m² · %</span></th><th>Total<br><span class="mut">dif m² · %</span></th></tr></thead>
    <tbody>${s.cruce.map(fila).join('')}${s.cruce.length>1?fila(T).replace('<tr>','<tr class="tt">'):''}</tbody></table></div>
    <p class="mut">«Correctas» = dentro de tolerancia. Cada OP cuenta en una sola columna según su cartón: mismo que el programado, cambio de cartón o con caja extra.</p>`;
  // 5 · Por modelo · 6 · Por tipo de cartón
  const r5=`${lg2}${hbars(s.modelo.slice(0,8))}<p class="mut">Los ${Math.min(8,s.modelo.length)} códigos con mayor diferencia absoluta de ${s.modelo.length}. Lista completa en «Exportar Excel»; por modelo principal y variantes en la pestaña <b>Modelos</b>.</p>`;
  const r6=`${lg2}${hbars(s.carton)}`;
  const mas=`<details class="card"><summary><b>Más desgloses</b> <span class="mut">(tipo de OP, Folio vs Línea, inclusiones por modelo)</span></summary>
    <h3>Por tipo de OP</h3>${lg2}${hbars(s.tipoOp)}<h3>Folio vs Línea</h3>${lg1}${gbars(s.clase)}
    <h3>Inclusiones por modelo (m² reales)</h3>${s.modInc.length?s.modInc.slice(0,12).map(x=>`<div class="line"><b>${fmt(x.R)} m²</b> · ${esc(x.k)} <span class="mut">(${x.n} reg.)</span></div>`).join(''):'<p class="mut">Sin inclusiones.</p>'}</details>`;
  $('#ana').innerHTML=SEC(1,'Resumen ejecutivo',r1)+SEC(2,'Indicadores principales',r2)+SEC(3,'Alertas importantes',r3)+
    (s.B.length?SEC(4,'Consumo esperado vs real por semana',r4)+SEC(5,'Por día de la semana',porDia(s.B),'sdia')+SEC(6,'Diferencias por modelo',r5)+SEC(7,'Diferencias por tipo de cartón',r6):'')+mas+motivosCambio(s.B)+
    `<p class="mut">8 · Seguimiento de modelos → pestaña <b>Modelos</b> · 9 · Detalle completo → pestaña <b>Tablero</b></p>`;
  const ds=$('#dsem');if(ds)ds.onchange=()=>{diaSem=ds.value;const y=window.scrollY;analysis();try{window.scrollTo(0,y)}catch(x){}};
}
// «Ver» en una alerta: conserva el periodo filtrado y abre la pestaña donde se revisa, ya filtrada.
// Descartar / volver a mostrar alertas (ver alertasMarcar en comun.js)
$('#ana').addEventListener('click',async e=>{const off=e.target.dataset.aloff,on=e.target.dataset.alon;if(!off&&!on)return;e.preventDefault();
  try{await alertasMarcar(off?[off]:on.split(','),!!off)}catch(x){dbErr(x,'No se pudo guardar')}analysis()});
$('#ana').onclick=e=>{const g=e.target.dataset.go;if(g==null)return;const [t,v]=g.split('|');
  $('#fs').value='';$('#fq').value='';if(t==='2'){if(v.startsWith('q:'))$('#fq').value=v.slice(2);else $('#fs').value=v}tab(+t)};

/* ==== 7 · SEGUIMIENTO DE MODELOS ====
   Agrupa por modelo principal (modeloPrincipal) y compara sus variantes.
   Variante fuera del patrón: usa un cartón distinto al de la mayoría del modelo, o sus m² por mueble se alejan más de la
   tolerancia de los m² por mueble típicos del modelo (mediana de sus OP). Solo OP completas; periodo = filtros activos. */
const med=a=>{const b=[...a].sort((x,y)=>x-y),n=b.length;return n?(n%2?b[(n-1)/2]:(b[n/2-1]+b[n/2])/2):0};
const moda=a=>{const c={};a.forEach(x=>c[x]=(c[x]||0)+1);return Object.keys(c).sort((x,y)=>c[y]-c[x])[0]||''};
const juego=r=>r.per.filter(p=>p.R>0).map(p=>p.a).sort((a,b)=>a-b).join(' + ')+' cm';
function modelosCalc(L){
  const B=L.filter(isA),G={};
  B.forEach(r=>{const k=modeloPrincipal(r.modelo);(G[k]||(G[k]=[])).push(r)});
  const out=Object.entries(G).map(([k,rs])=>{
    const mueb=a=>a.reduce((s,r)=>s+(r.cant||1),0),SE=a=>a.reduce((s,r)=>s+r.E,0),SR=a=>a.reduce((s,r)=>s+r.R,0);
    const jm=moda(rs.map(juego)),tip=med(rs.map(r=>(r.R+(r.Rsp||0))/(r.cant||1))),E=SE(rs),R=SR(rs),v=vp(R,E);
    const V={};rs.forEach(r=>(V[r.modelo]||(V[r.modelo]=[])).push(r));
    const vars=Object.entries(V).map(([c,a])=>{const mu=mueb(a),e=SE(a),rr=SR(a),j=moda(a.map(juego)),m2=(rr+a.reduce((t,r)=>t+(r.Rsp||0),0))/mu,dv=tip?(m2-tip)/tip*100:0;
      const mot=[];if(Object.keys(V).length>1){if(j!==jm)mot.push(`usa ${j}; el modelo usa ${jm}`);if(Math.abs(dv)>tolv)mot.push(`m² por mueble ${dv>0?'+':''}${dv.toFixed(1)} % vs el modelo`)}
      return{c,n:a.length,mu,E:e,R:rr,j,m2,esp:e/mu,v:vp(rr,e),dv,fuera:mot.length>0,mot,ult:Math.max(...a.map(r=>r.ts))}}).sort((a,b)=>b.fuera-a.fuera||Math.abs(b.R-b.E)-Math.abs(a.R-a.E));
    const nf=vars.filter(x=>x.fuera).length,stm=v==null?'Sin datos':Math.abs(v)<=tolv?'OK':v>0?'Usó más':'Usó menos';
    return{k,rs,n:rs.length,vars,nf,jm,tip,E,R,v,stm,rev:nf>0||stm==='Usó más'||stm==='Usó menos'};
  }).sort((a,b)=>b.rev-a.rev||b.nf-a.nf||Math.abs(b.R-b.E)-Math.abs(a.R-a.E));
  return{lista:out,revisar:out.filter(m=>m.nf).length,fuera:out.reduce((s,m)=>s+m.nf,0),aRev:out.filter(m=>m.rev).length};
}
function modelosView(){
  weeks();const L=filt(),M=modelosCalc(L),solo=$('#mrev').checked,lst=solo?M.lista.filter(m=>m.rev):M.lista;
  $('#dsum').innerHTML=`${cnt(L)}: ${M.lista.length} modelo(s) principal(es) con OP completas`;
  $('#mkpi').innerHTML=K('Modelos principales',M.lista.length)+K('Requieren revisión',M.aRev,M.aRev?'pos':'')+K('Variantes fuera del patrón',M.fuera,M.fuera?'pos':'','en '+M.revisar+' modelo(s)');
  const chip=st=>`<span class="chip st st-${st==='OK'?'ok':st==='Sin datos'?'sinop':'cons'}">${st}</span>`;
  $('#mlista').innerHTML=lst.length?lst.map(m=>`<details class="card mdl"${m.nf?' open':''}><summary><b>${esc(m.k)}</b> <span class="mut">· ${m.vars.length} variante(s) · ${m.n} OP · cartón habitual ${esc(m.jm)} · ${fmt(m.tip)} m²/mueble</span><br>
    ${chip(m.stm)} <span class="mut">vs esperado ${pct(m.R,m.E)} (${sgm(m.R-m.E)} m²)</span>${m.nf?` <span class="chip bad">${m.nf} variante(s) fuera del patrón</span>`:''}</summary>
    <div class="scroll"><table><thead><tr><th>Variante</th><th>OP</th><th>Cartón usado</th><th>m²/mueble real</th><th>vs esperado</th><th>Patrón</th></tr></thead><tbody>
    ${m.vars.map(x=>`<tr${x.fuera?' class="fx"':''}><td><b>${esc(x.c)}</b></td><td>${x.n}${x.n===1?' <span class="mut">(1 registro)</span>':''}</td><td>${esc(x.j)}</td><td>${fmt(x.m2)} <span class="mut">(esp. ${fmt(x.esp)})</span></td><td>${pct(x.R,x.E)}</td><td>${x.fuera?`<span class="chip st st-${x.j!==m.jm?'camb':'cons'}">Fuera del patrón</span><br><span class="mut">${esc(x.mot.join(' · '))}</span>`:m.vars.length>1?'<span class="chip st st-ok">En patrón</span>':'<span class="mut">única variante</span>'}</td></tr>`).join('')}
    </tbody></table></div></details>`).join(''):`<div class="card mut">${solo?'Ningún modelo requiere revisión con estos filtros. Desmarca «Solo los que requieren revisión» para ver todos.':'No hay OP completas con estos filtros.'}</div>`;
  $('#mreglas').textContent=AGRUPACION.nombre;$('#mexc').value=Object.entries(cfg.modelosExc||{}).map(([k,v])=>k+' = '+v).join('\n');
}
$('#mrev').onchange=()=>modelosView();
$('#msave').onclick=async()=>{const P={},bad=[];$('#mexc').value.split('\n').map(x=>x.trim()).filter(Boolean).forEach(l=>{const m=l.match(/^(\S+)\s*=\s*(\S.*)$/);if(m)P[m[1].toUpperCase()]=m[2].trim().toUpperCase();else bad.push(l)});
  if(bad.length){$('#mmsg').textContent='Revisa el formato «CÓDIGO = MODELO PRINCIPAL» en: '+bad.join(' | ');$('#mmsg').style.color='var(--bad)';return}
  try{await DB.saveSettings({modelosExc:P});cfg.modelosExc=P;$('#mmsg').textContent='Excepciones guardadas.';$('#mmsg').style.color='';modelosView()}catch(x){dbErr(x,'No se pudieron guardar las excepciones')}};
[...FSEL,'#ddet'].forEach(x=>$(x).oninput=()=>{lim=100;refresh()});
$('#more').onclick=()=>{lim+=100;board()};
$('#fclr').onclick=()=>{FSEL.forEach(x=>$(x).value='');lim=100;refresh()};
const sha=async t=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(t)))].map(x=>x.toString(16).padStart(2,'0')).join('');
function ask(mode){return new Promise(res=>{
  const d=$('#dlg'),cr=mode==='create';$('#dmsg').textContent=cr?'Crea una contraseña de administrador':'Contraseña de administrador';
  $('#dpw').value=$('#dpw2').value='';$('#derr').textContent='';$('#dpw2').classList.toggle('hide',!cr);
  $('#dok').onclick=async()=>{const p=$('#dpw').value;
    if(cr){if(p.length<6){$('#derr').textContent='Mínimo 6 caracteres.';return}if(p!==$('#dpw2').value){$('#derr').textContent='No coinciden.';return}
      const salt=[...crypto.getRandomValues(new Uint32Array(3))].join('-');await DB.setAuth({salt,h:await sha(salt+p)});d.close();res(true)}
    else{const a=await DB.getAuth();if(a&&await sha(a.salt+p)===a.h){d.close();res(true)}else $('#derr').textContent='Contraseña incorrecta.'}};
  $('#dno').onclick=()=>{d.close();res(false)};d.oncancel=()=>res(false);d.onkeydown=e=>{if(e.key==='Enter')$('#dok').click()};
  d.showModal();$('#dpw').focus()})}
$('#adm').onchange=async e=>{const on=e.target.checked;
  if(on){let ok=false;try{ok=await ask((await DB.getAuth())?'login':'create')}catch(x){alert('Este navegador no permite el login (abre el archivo desde https o localhost).')}
    if(!ok){e.target.checked=false;return}}
  document.body.classList.toggle('admin',on);if(!on)tab(1)};
$('#cpw').onclick=()=>ask('create');
$('#dsum').addEventListener('click',e=>{if(e.target.id!=='vdoble')return;e.preventDefault();$('#fs').value=$('#fs').value==='doble'?'':'doble';lim=100;refresh()});
$('#dbody').onclick=async e=>{
  const d=e.target.dataset;
  if(d.del&&confirm('¿Borrar este reporte?')){if(String(editId)===d.del){editId=null}
    try{await DB.deleteReport(d.del)}catch(x){dbErr(x,'No se pudo borrar')}
    await reload();board()}
  if(d.corr||d.uncorr){e.preventDefault();const id=d.corr||d.uncorr,r=reports.find(x=>String(x.id)===id);if(!r)return;
    const n={...r};if(d.corr)n.corr={ts:Date.now(),por:quien()};else delete n.corr;
    try{await DB.saveReport(n)}catch(x){dbErr(x,'No se pudo guardar la corrección')}
    await reload();board()}
  if(d.rev){const r=reports.find(x=>String(x.id)===d.rev);if(!r)return;
    try{await DB.saveReport({...r,rev:true})}catch(x){dbErr(x,'No se pudo marcar como revisada')}
    await reload();board()}
  if(d.ed){await reload();const r=reports.find(x=>String(x.id)===d.ed);
    if(!r){alert('Ese reporte ya no existe (se modificó en otra pestaña).');board();return}
    if(r.kind==='op'&&!cat[r.op]){alert('Esa OP ya no está en el catálogo cargado.');return}
    tab(1);$('#kind').value=r.kind;$('#kind').onchange();editId=r.id;start(r.kind,r.kind==='op'?r.op:r.modelo,r)}
};
$('#xbtn').onclick=()=>{
  const L=filt();if(!L.length){alert('No hay registros con el filtro actual.');return}
  const s=summ(L),M=modelosCalc(L),op=r=>r.kind==='op',Y=r=>r.mismo===null?'N/A':r.mismo?'Sí':'No',V=(R,E)=>{const v=vp(R,E);return v==null?'':r3(v)};
  const dbl=r=>esDoble(r)?(r.rev?'Revisada':'Pendiente de revisión'):'';
  const A=L.map(r=>{const e=est(r);return{'Tipo de registro':KINDS[r.kind],'OP':r.op,'Modelo':r.modelo,'Modelo principal (provisional)':modeloPrincipal(r.modelo),'Tipo de modelo':clase(r.modelo),'Estado':e.t,'Causa principal':e.c,
    'Cartón programado':op(r)?cartP(r):'','Cartón utilizado':cartU(r),'Coincidencia de cartón':op(r)&&isA(r)?COIN[coin(r)]:'','Consumo esperado (m²)':op(r)?r3(r.E):'','Consumo real (m²)':r3(r.R+(r.Rsp||0)),'Consumo sin programar (m²)':op(r)?r3(r.Rsp||0):'','Programación ERP':op(r)?progTxt(r):'','Seguimiento ERP':est(r).k==='sinprog'?SEG[segEstado(r.modelo,r.ts)]:'','Diferencia total (m²)':op(r)?r3(r.diff):'','Variación %':op(r)?V(r.R,r.E):'',
    'Diferencia por mueble (m²)':op(r)?r3(r.dm):'','Diferencia absoluta (m²)':op(r)?r3(r.abs):'','Cajas esperadas (Cant)':op(r)?r.ce:'','Cajas capturadas':r.cr,'Mismo tipo de cartón':Y(r),
    'Semana (registro)':r.semana,'Fecha de registro':ymd(new Date(r.ts)),'Vencimiento OP':r.venc||'','Tipo de OP':op(r)?tipoReg(r):'','Estado ERP':r.estadoERP,
    'OP doble consumo':dbl(r),'1/2 cartones confirmado por operador':r.conf12?'Sí':'','Operador':r.operador||'','Motivo cambio de cartón':motTxt(r),'Comentarios':r.com}});
  const ps=(r,p)=>r.kind!=='op'?KINDS[r.kind]:p.sp?'Sin programar':(p.E&&!p.R)?'Sin capturar':!p.E?'Cartón no esperado':Math.abs((p.R-p.E)/p.E*100)<=tolv?'Correcto':'Con diferencia';
  const D=[...L].sort((a,b)=>String(a.op).localeCompare(b.op)).flatMap(r=>r.per.map(p=>({'Tipo de registro':KINDS[r.kind],'OP':r.op,'Tipo de OP':op(r)?tipoReg(r):'','Modelo':r.modelo,'Tipo de modelo':clase(r.modelo),'Semana':r.semana,'Estado de la OP':est(r).t,
    'Cartón (cm)':p.a,'Esperado (m²)':r3(p.E),'Real (m²)':r3(p.R),'Diferencia (m²)':r3(p.R-p.E),'Variación %':V(p.R,p.E),'Estado del cartón':ps(r,p),'Cajas esperadas (Cant)':p.ce||'','Cajas capturadas':p.cr,
    'Medidas capturadas':r.snap.lines.filter(l=>l.a===p.a&&num(l.l)>0).map(l=>`${l.n} caja(s) × ${l.l} cm × ${l.c} cartón(es)`).join(' | ')})));
  const g=(t,a)=>[[t],['Concepto','Esperado (m²)','Real (m²)','Dif. neta (m²)','Variación %','Positiva (m²)','Negativa (m²)','Absoluta (m²)','Registros'],...a.map(x=>[x.k,r3(x.E),r3(x.R),r3(x.R-x.E),V(x.R,x.E),r3(x.P),r3(x.N),r3(x.P-x.N),x.n]),[]];
  const net=s.P+s.N,abs=s.P-s.N,cz=c=>[c.n,r3(c.R-c.E),V(c.R,c.E)];
  const CR=[['Semana × coincidencia de cartón (OP completas)'],['Semana','OP','Correctas','Mismo cartón: OP','Mismo cartón: dif (m²)','Mismo cartón: var %','Cambio de cartón: OP','Cambio: dif (m²)','Cambio: var %','Caja Extra: OP','Caja Extra: dif (m²)','Caja Extra: var %','Total dif (m²)','Total var %'],
    ...[...s.cruce,s.cruceTot].map(w=>[w.k,w.n,w.ok,...cz(w.mismo),...cz(w.cambio),...cz(w.extra),r3(w.R-w.E),V(w.R,w.E)]),[]];
  const RS=[['Indicadores generales (solo OP completas)'],['Esperado (m²)',r3(s.E)],['Real (m²)',r3(s.R)],['Variación %',V(s.R,s.E)],['Diferencia positiva (m²)',r3(s.P)],['Diferencia negativa (m²)',r3(s.N)],['Diferencia neta (m²)',r3(net)],
    ['Diferencia absoluta por OP (m²)',r3(abs)],['Diferencia absoluta por cartón (m²)',r3(s.AC)],['% compensado',abs?r3((abs-Math.abs(net))/abs*100):0],['OP analizadas',s.B.length],['OP correctas',s.ok],
    ['Registros incompletos (excluidos)',s.inc.length],['OP doble consumo pendientes de revisión',L.filter(doblePend).length],[],['Consumo sin OP (no entra en diferencias)'],['Inclusiones (registros)',s.incl.length],['Inclusiones (m² reales)',r3(s.Rinc)],
    ['Caja de Ingeniería (registros)',s.ingr.length],['Caja de Ingeniería (m² reales)',r3(s.Ring)],['Consumo real total: OP completas + sin OP (m²)',r3(s.Rtot)],[],['Registros por estado'],...Object.entries(L.reduce((m,r)=>{const t=est(r).t;m[t]=(m[t]||0)+1;return m},{})),[],
    ['Consumo sin programar en ERP (m²)',r3(s.Rsp)],['OP con consumo sin programar',s.sp.length],[],
    ['Sin programar por modelo (seguimiento)'],['Modelo','OP','m² sin programar','Seguimiento','Comentario','Por','Fecha'],
    ...segModelos(L).map(g=>{const x=cfg.seguimiento[g.modelo]||{};return[g.modelo,g.n,r3(g.R),SEG[g.estado],x.com||'',x.por||'',x.ts?dmy(x.ts):'']}),[],
    ...CR,...g('Por modelo (código completo)',s.modelo),...g('Por tipo de cartón',s.carton),...g('Folio vs Línea',s.clase),...g('Por tipo de OP',s.tipoOp),...g('Por tipo de registro',s.reg),...g('Inclusiones por modelo (solo real)',s.modInc),...g('Por semana (registro)',s.semana)];
  const MO=M.lista.flatMap(m=>m.vars.map(x=>({'Modelo principal (provisional)':m.k,'Estatus del modelo':m.stm,'Modelo: variación %':V(m.R,m.E),'Modelo: cartón habitual':m.jm,'Modelo: m²/mueble típico':r3(m.tip),
    'Variante':x.c,'OP':x.n,'Muebles':x.mu,'Cartón usado':x.j,'m²/mueble real':r3(x.m2),'m²/mueble esperado':r3(x.esp),'Variación % vs esperado':V(x.R,x.E),'Diferencia (m²)':r3(x.R-x.E),
    'Patrón':m.vars.length<2?'Única variante':x.fuera?'Fuera del patrón':'En patrón','Motivo':x.mot.join(' · '),'Último registro':ymd(new Date(x.ult))})));
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(A),'Reporte');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(D),'Desglose por OP');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(RS),'Resumen');
  XLSX.utils.book_append_sheet(wb,MO.length?XLSX.utils.json_to_sheet(MO):XLSX.utils.aoa_to_sheet([['Sin OP completas']]),'Modelos');
  XLSX.writeFile(wb,'consumo-carton-'+ymd(new Date())+'.xlsx');
};
// ==== Excel «formato registro» (TEMPORAL) ====  Solo valores (sin fórmulas), un renglón por CARTÓN (valores individuales,
// no el total de la OP). m² por mueble = m² de ese cartón ÷ Cant del ERP (Inclusión/Ingeniería: ÷ cajas capturadas).
// Cambio de cartón: programado y usado en el mismo renglón («NO»); usado sin programar = «CAJA EXTRA»; programado sin usar = «Pendiente».
const r2=x=>Math.round(x*100)/100;
function filasRegistro(L){const out=[];
  L.slice().sort((a,b)=>a.ts-b.ts).forEach(r=>{const op=r.kind==='op',P=(r.per||[]).filter(p=>pg(p)||p.R>0),d=new Date(r.ts);
    const div=op?(r.cant||1):(r.cr||1),lines=(r.snap&&r.snap.lines)||[];
    const largo=a=>{const v=[...new Set(lines.filter(Lx=>+Lx.a===+a&&num(Lx.l)>0&&num(Lx.n)>0).map(Lx=>num(Lx.l)))];return v.length===1?v[0]:v.join(' / ')};
    const prog=op?P.filter(p=>pg(p)&&!(p.R>0)):[],usad=P.filter(p=>p.R>0&&(!op||!pg(p))),pares=[];
    // emparejar cambios de cartón: primero con el motivo guardado (de → a), luego en orden
    (r.mcc||[]).forEach(m=>{const i=prog.findIndex(p=>+p.a===+m.de),j=usad.findIndex(p=>+p.a===+m.a);if(op&&i>=0&&j>=0)pares.push([prog.splice(i,1)[0],usad.splice(j,1)[0]])});
    while(op&&prog.length&&usad.length)pares.push([prog.shift(),usad.shift()]);
    // Real ÷ muebles realmente hechos (cajas capturadas de ese cartón convertidas a muebles con la proporción del ERP);
    // si se hicieron las cajas programadas, da lo mismo que ÷ Cant. Caja extra (sin programado): ÷ Cant como antes.
    const divR=(b,c)=>op&&b&&b.ce&&c.cr>0?c.cr*div/b.ce:div;
    const fila=(b,c)=>out.push({'Fecha registrado':Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())/864e5+25569,   // fecha de Excel (sin desfase de zona horaria)
      'OP':op?r.op:'','Modelo':r.modelo,
      'Tipo de cartón':b?b.a:'','Tipo de cartón realmente utilizado':c?c.a:'','Largo':c?largo(c.a):'','Muebles programados':op?(r.cant||''):'',
      'Metros utilizados por mueble':b?r2(b.E/div):'','Metros realmente utilizados':c?r2(c.R/divR(b,c)):'',
      'Mismo tipo de cartón registrado y utilizado':!c?'Pendiente':!b?'CAJA EXTRA':+b.a===+c.a?'SÍ':'NO'});
    P.filter(p=>op&&pg(p)&&p.R>0).forEach(p=>fila(p,p));pares.forEach(([b,c])=>fila(b,c));prog.forEach(p=>fila(p,null));usad.forEach(p=>fila(null,p))});
  return out}
$('#xreg').onclick=()=>{const L=filt();if(!L.length){alert('No hay registros con el filtro actual.');return}
  const F=filasRegistro(L),ws=XLSX.utils.json_to_sheet(F);F.forEach((_,i)=>{const c=ws['A'+(i+2)];if(c)c.z='dd/mm/yyyy'});ws['!cols']=[12,12,14,10,12,8,10,12,12,14].map(w=>({wch:w+4}));
  const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,ws,'Registro');XLSX.writeFile(wb,'registro-carton-'+ymd(new Date())+'.xlsx')};
$('#bk').onclick=async()=>{try{reports=await DB.listReports();cat=await DB.getCatalog()}catch(x){dbErr(x,'No se pudo leer para el respaldo');return}
  const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([JSON.stringify({v:3,reports,cat})],{type:'application/json'}));a.download='respaldo-consumo-carton-'+ymd(new Date())+'.json';a.click();
  const rp={ts:Date.now(),auto:false,por:quien()};try{await DB.saveSettings({respaldo:rp});cfg.respaldo=rp}catch(x){}showRespaldo()};
// Último respaldo (automático o manual): en rojo si pasan más de 2 días. El robot diario lo anota con marcar_respaldo().
function showRespaldo(){const r=cfg.respaldo,e=$('#bkinfo');if(!e)return;
  if(!r){e.innerHTML='<b style="color:var(--bad)">⚠ No hay respaldos registrados.</b> Descarga uno con «Respaldo (JSON)».';return}
  const d=Math.floor((Date.now()-r.ts)/864e5),h=new Date(r.ts).toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit'});
  const cuando=d<=0?'hoy':d===1?'ayer':`hace ${d} días`,tx=`Último respaldo: ${cuando} (${dmy(r.ts)} ${h}, ${r.auto?'automático':'manual'})`;
  e.innerHTML=d>2?`<b style="color:var(--bad)">⚠ ${tx}.</b> Revisa el respaldo automático o descarga uno con «Respaldo (JSON)».`:`<span style="color:var(--ok)">✓</span> ${tx}`}
$('#bki').onchange=async e=>{const f=e.target.files[0];if(!f)return;
  try{const d=JSON.parse(await f.text()),r=await DB.importReports(Array.isArray(d.reports)?d.reports:[]);
    cat=await DB.upsertOps(d.cat||{},{overwrite:false});await reload();showCat();
    $('#filemsg').textContent='Respaldo importado: '+r.added+' reportes nuevos ('+reports.length+' en total).'}
  catch(err){$('#filemsg').textContent='Respaldo inválido o no se pudo guardar.'}e.target.value=''};
// 1 Captura (operador y admin) · 3 Análisis · 4 Modelos · 2 Tablero (solo admin)
