import type { Request } from 'express'
import { supabaseAuth, supabaseAdmin } from './supabase.js'

export class HttpError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

export async function requireUser(req: Request): Promise<string> {
  const header = req.header('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : null
  if (!token) throw new HttpError(401, 'Falta el header Authorization')

  const { data, error } = await supabaseAuth.auth.getUser(token)
  if (error || !data.user) throw new HttpError(401, 'Token inválido')
  return data.user.id
}

// Mismo mecanismo que is_admin() en Postgres (admin_users sin policy propia,
// solo legible con service_role), pero de este lado: el dashboard interno de
// Trazalo (admin.trazaloapp.com) necesita poder limpiar archivos de
// cualquier negocio al borrarlo, no solo del suyo propio.
async function isAdminUser(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('admin_users')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle()
  return Boolean(data)
}

// No hay RLS documentada para replicar (no existe en el repo de trazaloApp),
// así que el chequeo de ownership se re-implementa acá a mano: este endpoint
// pasa a ser el perímetro de seguridad que antes cubría Supabase Storage.
export async function assertOwnsProject(userId: string, businessId: string, projectId: string): Promise<void> {
  if (await isAdminUser(userId)) return   // admin de Trazalo: puede operar sobre cualquier negocio

  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .eq('owner_id', userId)
    .maybeSingle()

  if (businessError) throw new HttpError(500, 'Error verificando el negocio')
  if (!business) throw new HttpError(403, 'No sos dueño de este negocio')

  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id')
    .eq('id', projectId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (projectError) throw new HttpError(500, 'Error verificando el proyecto')
  if (!project) throw new HttpError(403, 'El proyecto no pertenece a ese negocio')
}
