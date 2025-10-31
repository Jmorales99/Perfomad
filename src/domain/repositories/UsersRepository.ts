// src/domain/repositories/UsersRepository.ts

export interface CreateUserDTO {
  email: string
  password: string
  name: string
  age: number
}

export interface LoginDTO {
  email: string
  password: string
}

/**
 * 💾 UsersRepository
 * Define la interfaz base que implementan los repositorios (como SupabaseUserRepository)
 */
export interface UsersRepository {
  // 👤 Crear usuario en Auth
  createUser(dto: CreateUserDTO): Promise<{ id: string }>

  // 📄 Insertar perfil manualmente (modo desarrollo)
  insertProfile(
    id: string,
    email: string,
    name: string,
    age: number,
    phone: string
  ): Promise<void>

  // 🔍 Buscar perfil por ID (incluye teléfono)
  findProfileById(id: string): Promise<{
    id: string
    email: string
    name: string
    age: number
    phone?: string
  } | null>

  // 🔐 Iniciar sesión
  loginUser(dto: LoginDTO): Promise<{ access_token: string; user: any }>
}
