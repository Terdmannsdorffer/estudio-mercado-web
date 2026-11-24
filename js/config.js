/* Configuración de la app.
   Con la URL y la clave pública, la app usa la base de datos en la nube (Supabase)
   y pide iniciar sesión. Si se dejan vacías, guarda solo en el navegador.
   La clave "publishable" es pública por diseño: los datos los protege el inicio de
   sesión y Row Level Security. La clave secreta nunca va aquí. */
const APP_CONFIG = {
  storageKey: "estudio_mercado_v3",
  legacyStorageKey: "petfood_market_342_v2", // datos guardados por la versión anterior
  backupReminderDays: 7,
  supabase: {
    url: "https://ztozjlxmdgeuelqdvusv.supabase.co",
    anonKey: "sb_publishable_EigIvLopw9W8Fw0-4UBZBg_6Fu1MIei"
  }
};
