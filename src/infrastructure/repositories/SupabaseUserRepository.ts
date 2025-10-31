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
    if (!isProd) {
      const { data, error } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        user_metadata: { name, age: Number(age) },
        email_confirm: true,
      })

      if (error) {
        console.error("❌ Error al crear usuario (dev):", error)
        throw new Error(error.message || "Error al crear usuario (dev).")
      }

      return { id: data.user!.id }
    }

    const { data, error } = await supabaseClient.auth.signUp({
      email,
      password,
      options: {
        data: { name, age: Number(age) },
        emailRedirectTo: "http://localhost:5173/auth",
      },
    })

    if (error) {
      console.error("❌ Error al crear usuario:", error)
      throw new Error(error.message || "Error al registrar el usuario.")
    }

    if (!data.user) {
      throw new Error("No se pudo crear el usuario.")
    }

    return { id: data.user.id }
  }

  // 🧩 insertProfile ahora acepta también el teléfono
  async insertProfile(
    id: string,
    email: string,
    name: string,
    age: number,
    phone: string
  ): Promise<void> {
    if (isProd) return

    const { error } = await supabaseAdmin
      .from("profiles")
      .insert({ id, email, name, age, phone })

    if (error) {
      console.error("❌ Error al guardar perfil (dev):", error)
      throw new Error("Error al guardar el perfil del usuario (dev).")
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

  async loginUser({
    email,
    password,
  }: LoginDTO): Promise<{ access_token: string; user: any }> {
    const { data, error } = await supabaseClient.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      console.error("❌ Error al iniciar sesión:", error)
      throw new Error("Credenciales inválidas o cuenta no confirmada.")
    }

    return {
      access_token: data.session?.access_token!,
      user: data.user,
    }
  }
}
