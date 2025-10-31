import type { FastifyInstance } from 'fastify'
import { userRoutes } from './routes/userRoutes.js'
import { ProfileController } from '../interfaces/http/controllers/ProfileController.js'
import { CampaignsController } from '../interfaces/http/controllers/CampaignsController.js'
import { ImagesController } from '@/interfaces/http/controllers/ImagesController.js'

export async function routes(app: FastifyInstance) {
  await app.register(userRoutes, { prefix: '/users' })
  await app.register(ProfileController, { prefix: '/profile' })
  await app.register(CampaignsController, { prefix: '' })
  await app.register(ImagesController, { prefix: '' })
}