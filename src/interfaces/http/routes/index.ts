import type { FastifyInstance } from "fastify"
import { userRoutes } from "./userRoutes.js"
import { ProfileController } from "@/interfaces/http/controllers/ProfileController"
import { CampaignsController } from "@/interfaces/http/controllers/CampaignsController"
import { ImagesController } from "@/interfaces/http/controllers/ImagesController"
import { PlatformsController } from "@/interfaces/http/controllers/PlatformsController"
import { ClientsController } from "@/interfaces/http/controllers/ClientsController"

export async function routes(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: "/users" })
  await app.register(ProfileController, { prefix: "/profile" })
  await app.register(ClientsController, { prefix: "/clients" })
  await app.register(CampaignsController, { prefix: "" })
  await app.register(ImagesController, { prefix: "" })
  await app.register(PlatformsController, { prefix: "" })
}
