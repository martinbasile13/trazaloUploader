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

// Permite operar sobre el proyecto a:
// 1. Admins de Trazalo (admin_users).
// 2. Dueño del negocio (businesses.owner_id o business_members con role 'owner').
// 3. Administradores/Encargados del negocio (business_members con role 'admin').
// 4. Colaboradores/Operarios asignados a la obra (project_assignments).
export async function assertOwnsProject(userId: string, businessId: string, projectId: string): Promise<void> {
  if (await isAdminUser(userId)) return   // admin de Trazalo: puede operar sobre cualquier negocio

  // 1. Verificar que el proyecto exista y pertenezca al negocio indicado
  const { data: project, error: projectError } = await supabaseAdmin
    .from('projects')
    .select('id, business_id')
    .eq('id', projectId)
    .eq('business_id', businessId)
    .maybeSingle()

  if (projectError) throw new HttpError(500, 'Error verificando el proyecto')
  if (!project) throw new HttpError(404, 'El proyecto no pertenece a ese negocio')

  // 2. Si es el dueño del negocio en la tabla businesses, tiene acceso completo
  const { data: business, error: businessError } = await supabaseAdmin
    .from('businesses')
    .select('owner_id')
    .eq('id', businessId)
    .maybeSingle()

  if (businessError) throw new HttpError(500, 'Error verificando el negocio')
  if (!business) throw new HttpError(404, 'Negocio no encontrado')

  if (business.owner_id === userId) {
    return
  }

  // 3. Verificar si es miembro activo del equipo (Plan Pyme)
  const { data: member, error: memberError } = await supabaseAdmin
    .from('business_members')
    .select('role, status')
    .eq('business_id', businessId)
    .eq('user_id', userId)
    .eq('status', 'active')
    .maybeSingle()

  if (memberError) throw new HttpError(500, 'Error verificando membresía del equipo')
  if (!member) throw new HttpError(403, 'No pertenecés a este negocio')

  // Dueño o Administrador/Encargado tienen acceso a todas las obras del negocio
  if (member.role === 'admin' || member.role === 'owner') {
    return
  }

  // Colaborador/Operario: debe estar asignado a este proyecto específico
  const { data: assignment, error: assignError } = await supabaseAdmin
    .from('project_assignments')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .maybeSingle()

  if (assignError) throw new HttpError(500, 'Error verificando asignación de obra')
  if (!assignment) {
    throw new HttpError(403, 'No estás asignado a este trabajo')
  }
}
