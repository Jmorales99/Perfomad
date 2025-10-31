import { UsersRepository } from "../../domain/repositories/UsersRepository"

interface RegisterUserInput {
  email: string
  password: string
  name: string
  age: number
  phone: string
}

export class RegisterUser {
  constructor(private usersRepository: UsersRepository) {}

  async execute({ email, password, name, age, phone }: RegisterUserInput) {
    // 🧩 Validaciones básicas
    if (!email || !password || !name || age === undefined || !phone)
      throw new Error("Todos los campos son requeridos.")

    if (age < 13)
      throw new Error("Debes tener al menos 13 años para registrarte.")

    const phoneRegex = /^\+[1-9]\d{6,14}$/
    if (!phoneRegex.test(phone))
      throw new Error("El número de teléfono debe tener un formato válido (E.164).")

    // 👤 Crear usuario en Supabase Auth
    const { id } = await this.usersRepository.createUser({
      email,
      password,
      name,
      age,
    })

    /**
     * 🚀 Comportamiento según entorno:
     * - En producción: el trigger de Supabase creará el perfil al confirmar el email.
     * - En desarrollo: el perfil se crea manualmente si no existe aún.
     */
    if (process.env.NODE_ENV === "development") {
      console.log("🧑‍💻 [DEV] Verificando existencia de perfil...")

      const existingProfile = await this.usersRepository.findProfileById(id)

      if (!existingProfile) {
        console.log("📄 [DEV] Creando perfil manualmente (modo desarrollo)...")
        await this.usersRepository.insertProfile(id, email, name, age, phone)
      } else {
        console.log("✅ [DEV] Perfil ya existente, no se inserta duplicado.")
      }
    }

    return {
      message:
        "Usuario registrado correctamente. Revisa tu correo electrónico para confirmar tu cuenta.",
      user_id: id,
    }
  }
}
