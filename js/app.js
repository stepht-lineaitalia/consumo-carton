// Arranque de la app: navegación entre pestañas, sesión, roles y operador. Se carga al final.
/* ==== MÓDULOS (menú lateral de Administración) ====
   Cartón (Captura, Análisis, Modelos, Tablero) · Hojas single · Comparativo de consumos. Planta no ve el menú: siempre queda en Cartón → Captura. */
const MODS={carton:{t:'Consumo de cartón',s:'Captura en cm, cálculo y reportes en m².'},
  hojas:{t:'Hojas single',s:'Programa, PDF de producción y control en hojas.'},
  ambos:{t:'Comparativo de consumos',s:'Cartón y hojas single de una OP o de un modelo, lado a lado.'}};
let modulo='carton';
function verModulo(m){if(m!=='carton'&&!document.body.classList.contains('admin'))m='carton';modulo=m;
  document.querySelectorAll('#side .mh').forEach(b=>b.classList.toggle('on',b.dataset.mod===m));
  $('#subcarton').classList.toggle('hide',m!=='carton');$('#subhojas').classList.toggle('hide',m!=='hojas');$('#ttl').textContent=MODS[m].t;$('#subt').textContent=MODS[m].s;
  $('#vh').classList.toggle('hide',m!=='hojas');$('#va').classList.toggle('hide',m!=='ambos');
  if(m!=='carton'){[1,2,3,4].forEach(i=>$('#v'+i).classList.add('hide'));$('#flt').classList.add('hide')}}
function irModulo(m){if(m==='carton')tab(cur);else{verModulo(m);if(m==='hojas')hsAbrir();if(m==='ambos')compAbrir()}}
$('#side').addEventListener('click',e=>{const b=e.target.closest('.mh');if(b)irModulo(b.dataset.mod)});
// Menú ocultable (☰): se recuerda en este equipo. Ruta actual arriba del título («Cartón › Tablero») para no perderse con el menú oculto.
document.body.classList.toggle('sidecol',PREF.get('sidecol')==='1');
$('#sidetg').onclick=()=>{const c=!document.body.classList.contains('sidecol');document.body.classList.toggle('sidecol',c);PREF.set('sidecol',c?'1':'')};
function ruta(){const m=document.querySelector('#side .mh.on'),s=document.querySelector('#side .subm:not(.hide) button.on');
  $('#crumb').textContent=(m?m.textContent:'')+(s?' › '+s.textContent:'')}
new MutationObserver(ruta).observe($('#side'),{subtree:true,attributes:true,attributeFilter:['class']});ruta();
async function tab(n){verModulo('carton');if(n!==1&&!document.body.classList.contains('admin'))n=1;if(n===1&&document.body.classList.contains('ro'))n=3;cur=n;
  [1,2,3,4].forEach(i=>{$('#v'+i).classList.toggle('hide',n!==i);$('#t'+i).classList.toggle('on',n===i)});
  $('#flt').classList.toggle('hide',n===1);$('#ddetw').classList.toggle('hide',n!==2);
  if(n!==1){await reload();if(cur!==n)return}
  if(n===2)board();if(n===3)analysis();if(n===4)modelosView();if(n===1)misHoy()}
$('#t1').onclick=()=>tab(1);$('#t2').onclick=()=>tab(2);$('#t3').onclick=()=>tab(3);$('#t4').onclick=()=>tab(4);
/* ==== SESIÓN, ROLES Y OPERADOR ====
   Modo local: «Modo admin» con contraseña en el navegador (como en 4.x).
   Nube: inicio de sesión (Supabase Auth) y rol de la tabla «perfiles»:
     admin → todo · planta → solo Captura · consulta → Análisis, Modelos y Tablero sin poder modificar. */
const ROL={admin:'Administración',planta:'Planta',consulta:'Consulta'};
let sesion=null,operadores=[],operador='';
operador=PREF.get('operador');
function aplicarRol(){const nube=DB.name==='nube',rol=sesion&&sesion.rol;
  document.body.classList.toggle('nube',nube);document.body.classList.remove('login');
  if(nube){document.body.classList.toggle('admin',rol==='admin'||rol==='consulta');document.body.classList.toggle('ro',rol==='consulta')}
  $('#admw').classList.toggle('hide',nube);$('#ses').classList.toggle('hide',!nube);
  if(nube)$('#ses').innerHTML=`${esc(sesion.nombre||sesion.email)} · ${esc(ROL[rol]||rol)} <button class="btn ghost sm" id="salir" type="button">Salir</button>`}
function mostrarLogin(msg){document.body.classList.add('login','nube');$('#admw').classList.add('hide');$('#vlogin').classList.remove('hide');$('#lmsg').textContent=msg||'';stat('')}
// Ninguna espera del servidor se queda colgada: si no responde a tiempo, mensaje claro (y se puede reintentar).
let LIMITE_MS=20000;   // 20 s
const conLimite=(p,ms=LIMITE_MS)=>Promise.race([p,new Promise((_,ko)=>setTimeout(()=>{const x=new Error('El servidor tardó demasiado en responder. Revisa la conexión a internet'+(otraPestana?' y cierra la otra pestaña de la app':'')+'; luego recarga la página (F5).');x.code='timeout';ko(x)},ms))]);
// Aviso si la app está abierta en otra pestaña de este navegador (dos pestañas pueden trabar el inicio de sesión).
let otraPestana=false;
try{const bc=new BroadcastChannel('consumo-carton');bc.onmessage=e=>{if(e.data==='hola')bc.postMessage('aqui');if(e.data==='aqui'&&!otraPestana){otraPestana=true;
  const m='⚠ La app ya está abierta en otra pestaña de este navegador. Usa solo una para evitar problemas al iniciar sesión o guardar.';stat(m,true);if(!$('#vlogin').classList.contains('hide'))$('#lmsg').textContent=m}};
  bc.postMessage('hola')}catch(e){}
$('#flogin').onsubmit=async e=>{e.preventDefault();$('#lmsg').textContent='Entrando…';$('#flogin button').disabled=true;
  try{sesion=await conLimite(DB.entrar($('#lmail').value.trim(),$('#lpw').value));$('#lpw').value='';
    if(!sesion||!sesion.rol){mostrarLogin('Tu usuario no tiene un rol asignado. Pide al administrador que lo dé de alta.');return}
    $('#vlogin').classList.add('hide');await cargarApp()}
  catch(x){$('#lmsg').textContent=x.message||'No se pudo iniciar sesión.'}
  finally{$('#flogin button').disabled=false}};
$('#ses').onclick=async e=>{if(e.target.id!=='salir')return;try{await DB.salir()}catch(x){}PREF.set('operador','');location.reload()};
// ¿Quién captura? (solo si administración definió la lista de operadores). Se recuerda en el equipo.
function showOperador(){const c=$('#opcard');if(!operadores.length){c.classList.add('hide');return}c.classList.remove('hide');
  c.innerHTML=operadores.includes(operador)?`<div class="head"><span>Operador: <b>${esc(operador)}</b></span><button class="btn ghost sm" id="opchg" type="button">Cambiar</button></div>`:
    `<label class="mut">¿Quién captura?<select id="opsel"><option value="">Elige tu nombre…</option>${operadores.map(n=>`<option>${esc(n)}</option>`).join('')}</select></label>`}
$('#opcard').onchange=e=>{if(e.target.id!=='opsel')return;operador=e.target.value;PREF.set('operador',operador);showOperador();misHoy()};
$('#opcard').onclick=e=>{if(e.target.id!=='opchg')return;operador='';PREF.set('operador','');showOperador();misHoy()};
$('#saveopr').onclick=async()=>{const L=[...new Set($('#oprcfg').value.split('\n').map(x=>x.trim()).filter(Boolean))];
  try{await DB.saveOperadores(L);operadores=L;showOperador();cfgMsg(L.length?`Operadores guardados (${L.length}).`:'Lista vacía: no se preguntará quién captura.')}catch(x){dbErr(x,'No se pudieron guardar los operadores')}};
async function cargarApp(){
  aplicarRol();stat('Cargando datos…');
  try{const [st,c,r,o]=await Promise.all([DB.getSettings(),DB.getCatalog(),DB.listReports(),DB.listOperadores()]);
    tolv=st.tol;cfg={tol:st.tol,cartones:st.cartones||cfg.cartones,prefijos:st.prefijos||cfg.prefijos,excluir:st.excluir||cfg.excluir,modelosExc:st.modelosExc||cfg.modelosExc,seguimiento:st.seguimiento||{},respaldo:st.respaldo||null};cat=c;reports=r;operadores=o||[];stat('')}
  catch(e){dbErr(e,'No se pudieron cargar los datos')}
  $('#tol').value=tolv;$('#oprcfg').value=operadores.join('\n');showRespaldo();showCat();showCfg();showOperador();misHoy();
  DB.onChange(async()=>{await reload();if(cur!==1)refresh();else misHoy()});
  if(document.body.classList.contains('ro'))tab(3);
}
async function startApp(){
  if(DB.name==='nube'){stat('Conectando…');
    try{sesion=await conLimite(DB.sesion())}catch(e){if(e.code==='timeout')return mostrarLogin(e.message);dbErr(e,'No se pudo conectar con el servidor');return}
    if(!sesion)return mostrarLogin();
    if(!sesion.rol)return mostrarLogin('Tu usuario no tiene un rol asignado. Pide al administrador que lo dé de alta.');
  }
  await cargarApp();
}
startApp();
