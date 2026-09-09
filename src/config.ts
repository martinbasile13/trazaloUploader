function required(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}`)
  }
  return value
}

export const config = {
  port: Number(process.env.PORT ?? 8787),

  supabaseUrl: required('SUPABASE_URL'),
  supabaseAnonKey: required('SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),

  r2AccountId: required('R2_ACCOUNT_ID'),
  r2AccessKeyId: required('R2_ACCESS_KEY_ID'),
  r2SecretAccessKey: required('R2_SECRET_ACCESS_KEY'),
  r2BucketName: required('R2_BUCKET_NAME'),
  r2PublicBaseUrl: required('R2_PUBLIC_BASE_URL').replace(/\/$/, ''),

  // Lista separada por comas — permite probar desde localhost sin sacar la
  // producción de la lista (ej. "https://trazaloapp.com,http://localhost:5173")
  allowedOrigins: (process.env.ALLOWED_ORIGIN ?? '*').split(',').map((o) => o.trim()),
}
