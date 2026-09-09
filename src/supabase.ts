import { createClient } from '@supabase/supabase-js'
import { config } from './config.js'

// Solo para validar el JWT que manda el navegador (auth.getUser). Nunca se
// usa para leer/escribir tablas — eso es trabajo del cliente de abajo.
export const supabaseAuth = createClient(config.supabaseUrl, config.supabaseAnonKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// service_role: bypassea RLS a propósito. Este servicio ES el perímetro de
// autorización (ver auth.ts) — nunca exponer esta key fuera de acá.
export const supabaseAdmin = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
