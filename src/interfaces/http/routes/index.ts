import type { FastifyInstance } from "fastify"
import { userRoutes } from "./userRoutes.js"
import { ProfileController } from "@/interfaces/http/controllers/ProfileController"
import { CampaignsController } from "@/interfaces/http/controllers/CampaignsController"
import { MediaController } from "@/interfaces/http/controllers/MediaController.js"
import { PlatformsController } from "@/interfaces/http/controllers/PlatformsController"
import { ClientsController } from "@/interfaces/http/controllers/ClientsController"
import { DashboardController } from "@/interfaces/http/controllers/DashboardController"
import { MultichannelCampaignsController } from "@/interfaces/http/controllers/MultichannelCampaignsController"
import { ProductsController } from "@/interfaces/http/controllers/ProductsController"
import { GoogleAdsDiagnosticsController } from "@/interfaces/http/controllers/GoogleAdsDiagnosticsController"
import { MerchantCenterController } from "@/interfaces/http/controllers/MerchantCenterController"
import { env } from "@/config/env"

export async function routes(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: "/users" })
  await app.register(ProfileController, { prefix: "/profile" })
  await app.register(ClientsController, { prefix: "/clients" })
  await app.register(CampaignsController, { prefix: "" })
  await app.register(MediaController, { prefix: "" })
  await app.register(PlatformsController, { prefix: "" })
  await app.register(DashboardController, { prefix: "" })
  await app.register(MultichannelCampaignsController, { prefix: "/multichannel-campaigns" })
  await app.register(ProductsController, { prefix: "" })
  await app.register(MerchantCenterController, { prefix: "" })
  if (env.NODE_ENV !== "production") {
    await app.register(GoogleAdsDiagnosticsController, { prefix: "" })
  }
}
