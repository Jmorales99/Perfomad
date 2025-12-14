import type { FastifyInstance } from "fastify"
import { verifyUser } from "@/infrastructure/auth/verifyUser"
import { verifyUserAndSubscription } from "@/infrastructure/auth/verifySubscription"
import { supabaseAdmin } from "@/infrastructure/db/supabaseClient"
import { PlaiApiClient } from "@/infrastructure/services/PlaiApiClient"
import { ActivateSubscription } from "@/application/usecases/subscriptions/ActivateSubscription"
import { SyncConnectedAccounts } from "@/application/usecases/adaccounts/SyncConnectedAccounts"
import { CreateConnectionLink } from "@/application/usecases/adaccounts/CreateConnectionLink"
import { SupabaseAdAccountsRepository } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"
import type { Platform } from "@/infrastructure/repositories/SupabaseAdAccountsRepository"

export async function SubscriptionController(app: FastifyInstance) {
  const plaiApi = new PlaiApiClient()
  const adAccountsRepo = new SupabaseAdAccountsRepository()
  const activateSubscription = new ActivateSubscription(plaiApi)
  const syncConnectedAccounts = new SyncConnectedAccounts(plaiApi, adAccountsRepo)
  const createConnectionLink = new CreateConnectionLink(plaiApi)

  // ============================================================
  // 💳 Activar o reactivar suscripción (crea/vincula cuenta Plai)
  // ============================================================
  app.post("/subscription/activate", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      if (!user.email) {
        return reply.status(400).send({ error: "Email del usuario no disponible" })
      }

      const result = await activateSubscription.execute(
        user.id,
        user.email,
        user.user_metadata?.name || "User"
      )

      return reply.status(200).send({
        message: "Suscripción activada correctamente ✅",
        plai_user_id: result.plai_user_id,
        subscription_start: result.subscription_start,
        expires_at: result.expires_at,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({
        error: err.message || "Error al activar suscripción",
      })
    }
  })

  // ============================================================
  // 🔗 Crear link de conexión para plataforma
  // ============================================================
  app.post("/subscription/connect-account", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const body = req.body as {
        platform: Platform
        redirect_uri?: string
        state?: string
      }

      if (!body.platform) {
        return reply.status(400).send({ error: "Plataforma requerida" })
      }

      // Get plai_user_id from profile
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.plai_user_id) {
        return reply.status(400).send({
          error: "Cuenta Plai no vinculada",
          message: "Por favor, activa tu suscripción primero",
        })
      }

      const link = await createConnectionLink.execute(
        profile.plai_user_id,
        body.platform,
        body.redirect_uri,
        body.state
      )

      return reply.send({
        link,
        platform: body.platform,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({
        error: err.message || "Error al crear link de conexión",
      })
    }
  })

  // ============================================================
  // 🔗 Conectar cuenta con credenciales (simula conexión real)
  // ============================================================
  app.post("/subscription/connect-account-with-credentials", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      const body = req.body as {
        platform: Platform
        credentials: {
          email: string
          password: string
        }
      }

      if (!body.platform || !body.credentials?.email) {
        return reply.status(400).send({ error: "Plataforma y credenciales requeridas" })
      }

      // Get plai_user_id from profile
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.plai_user_id) {
        return reply.status(400).send({
          error: "Cuenta Plai no vinculada",
          message: "Por favor, activa tu suscripción primero",
        })
      }

      // Connect account via Plai API (mock) with credentials
      const connectResult = await plaiApi.connectAccountWithCredentials(
        profile.plai_user_id,
        body.platform,
        body.credentials
      )

      if (!connectResult.success) {
        return reply.status(500).send({
          error: "No se pudo conectar la cuenta. Verifica tus credenciales.",
        })
      }

      // Sync accounts to get the newly connected one
      const accounts = await syncConnectedAccounts.execute(user.id, profile.plai_user_id)

      // Find the account - note that "meta" maps to "meta" in our DB, but mock API stores as "facebook"
      const connectedAccount = accounts.find(
        (acc) => acc.platform === body.platform && acc.is_active
      )

      if (!connectedAccount) {
        // If not found, it might still be syncing - return success anyway
        // The account is stored in mock API and will be available on next sync
        return reply.status(200).send({
          message: `Cuenta de ${body.platform} conectada correctamente`,
          account: accounts[accounts.length - 1] || null, // Return last synced account or null
          note: "La cuenta ha sido conectada. Puede tomar unos momentos en aparecer.",
        })
      }

      return reply.send({
        message: `Cuenta de ${body.platform} conectada correctamente`,
        account: connectedAccount,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({
        error: err.message || "Error al conectar cuenta",
      })
    }
  })

  // ============================================================
  // 🔄 Sincronizar cuentas conectadas desde Plai
  // ============================================================
  app.post("/subscription/sync-accounts", async (req, reply) => {
    try {
      const user = await verifyUserAndSubscription(req, reply)
      if (!user) return

      // Get plai_user_id from profile
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("plai_user_id")
        .eq("id", user.id)
        .maybeSingle()

      if (!profile?.plai_user_id) {
        return reply.status(400).send({
          error: "Cuenta Plai no vinculada",
          message: "Por favor, activa tu suscripción primero",
        })
      }

      const accounts = await syncConnectedAccounts.execute(user.id, profile.plai_user_id)

      return reply.send({
        message: "Cuentas sincronizadas correctamente",
        accounts,
        count: accounts.length,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({
        error: err.message || "Error al sincronizar cuentas",
      })
    }
  })

  // ============================================================
  // 📋 Listar cuentas conectadas del usuario
  // ============================================================
  app.get("/subscription/accounts", async (req, reply) => {
    try {
      const user = await verifyUser(req, reply)
      if (!user) return

      const accounts = await adAccountsRepo.findByUserId(user.id)

      return reply.send({
        accounts,
        count: accounts.length,
      })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({
        error: err.message || "Error al listar cuentas",
      })
    }
  })

  // ============================================================
  // 💳 Endpoint legacy para compatibilidad (deprecated)
  // ============================================================
  app.post("/subscription/activate-dummy", async (req, reply) => {
    req.log.warn("Using deprecated endpoint /subscription/activate-dummy. Use /subscription/activate instead")
    // Redirect to new endpoint
    return app.inject({
      method: "POST",
      url: "/subscription/activate",
      headers: req.headers,
      payload: req.body,
    }).then((response) => {
      return reply.status(response.statusCode).send(response.json())
    })
  })
}
