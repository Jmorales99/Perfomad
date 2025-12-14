import { supabaseClient, supabaseAdmin } from "../db/supabaseClient.js"
import { isProd } from "../../config/env.js"
import {
  UsersRepository,
  CreateUserDTO,
  LoginDTO,
} from "../../domain/repositories/UsersRepository"

export class SupabaseUserRepository implements UsersRepository {
  async createUser({
    email,
    password,
    name,
    age,
  }: CreateUserDTO): Promise<{ id: string }> {
    // SIMPLIFIED: Just like Supabase Dashboard - email + password only
    // Store extra data (name, age) in user_metadata
    // Profile with phone, etc. is created separately
    console.log("🔍 Creating user (email + password)...")
    
    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { name, age: Number(age) },
        emailRedirectTo: "http://localhost:5173/auth",
      },
    })

    if (error) {
      console.error("❌ Error:", error.message)
      throw new Error(error.message || "Error al crear usuario.")
    }

    // Return user ID if available, or throw helpful error
    if (data.user) {
      console.log("✅ Usuario creado:", data.user.id)
      return { id: data.user.id }
    }

    // User created but needs email confirmation
    if (data.session?.user) {
      console.log("✅ Usuario creado y confirmado:", data.session.user.id)
      return { id: data.session.user.id }
    }

    // User was created but requires email confirmation
    throw new Error("Usuario creado. Por favor confirma tu email para continuar.")
  }


  // 🧩 insertProfile ahora acepta también el teléfono
  async insertProfile(
    id: string,
    email: string,
    name: string,
    age: number,
    phone: string
  ): Promise<void> {
    const { error } = await supabaseAdmin
      .from("profiles")
      .insert({ id, email, name, age, phone })
      .select()
      .single()

    if (error) {
      // If profile already exists (from trigger or previous attempt), that's ok
      if (error.code === "23505") { // Unique violation
        console.log("✅ Perfil ya existe, omitiendo creación")
        return
      }
      console.error("❌ Error al guardar perfil:", error)
      throw new Error("Error al guardar el perfil del usuario.")
    }
  }

  // ✅ Devuelve todos los campos del perfil, incluido el phone
  async findProfileById(id: string): Promise<{
    id: string
    email: string
    name: string
    age: number
    phone?: string
  } | null> {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id, email, name, age, phone")
      .eq("id", id)
      .maybeSingle()

    if (error && error.code !== "PGRST116") {
      console.error("❌ Error al verificar perfil:", error)
      throw new Error("Error al verificar perfil existente.")
    }

    return data
  }

  async loginUser({ email, password }: LoginDTO): Promise<{ access_token: string; user: any }> {
  // 👇 usa el cliente normal, no el admin
  const { data, error } = await supabaseClient.auth.signInWithPassword({
    email,
    password,
  })

  if (error) {
    console.error("❌ Error al iniciar sesión:", error)
    throw new Error("Credenciales inválidas o cuenta no confirmada.")
  }

  if (!data.session?.access_token) {
    throw new Error("No se pudo obtener token de sesión.")
  }

  return {
    access_token: data.session.access_token,
    user: data.user,
  }
}
}
