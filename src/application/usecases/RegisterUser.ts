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

    // 👤 Crear usuario en Supabase Auth (solo email + password)
    const { id } = await this.usersRepository.createUser({
      email,
      password,
      name,
      age,
    })

    // 🚀 Crear perfil con información adicional (phone, etc.)
    // Solo si el usuario fue creado exitosamente (no está esperando confirmación)
    try {
      const existingProfile = await this.usersRepository.findProfileById(id)

      if (!existingProfile) {
        await this.usersRepository.insertProfile(id, email, name, age, phone)
        console.log("✅ Perfil creado exitosamente")
      } else {
        console.log("✅ Perfil ya existe")
      }
    } catch (profileError: any) {
      // Si falla la creación del perfil, no fallar todo el registro
      // El usuario ya está creado, el perfil se puede crear después
      console.error("⚠️ No se pudo crear el perfil, pero el usuario fue creado:", profileError.message)
    }

    return {
      message:
        "Usuario registrado correctamente. Revisa tu correo electrónico para confirmar tu cuenta.",
      user_id: id,
    }
  }
}
