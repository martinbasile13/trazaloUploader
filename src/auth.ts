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

// No hay RLS documentada para replicar (no existe en el repo de trazaloApp),
// así que el chequeo de ownership se re-implementa acá a mano: este endpoint
// pasa a ser el perímetro de seguridad que antes cubría Supabase Storage.
export async function assertOwnsProject(userId: string, businessId: string, projectId: string): Promise<void> {
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
