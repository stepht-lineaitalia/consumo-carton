// Configuración de la nube (Supabase) para Línea Italia · proyecto «CONSUMO CARTÓN». Ver GUIA-NUBE.md, paso 4.
// La clave «Publishable» (sb_publishable_…) es pública por diseño: la seguridad la dan el inicio de sesión y los permisos (RLS)
// de supabase/esquema.sql. NUNCA pongas aquí la clave «secret» ni la «service_role».
// Si se dejan vacías, la app trabaja solo en el navegador (modo local).
window.CC_CONFIG = {
  supabaseUrl: 'https://nmoaoyonawanrrrntuim.supabase.co',
  supabaseAnonKey: 'sb_publishable_ByepjKDFPJUIHhOhNwK9uw_jQXkiE5p'
};
