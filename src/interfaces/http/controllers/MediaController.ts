import type { FastifyInstance } from 'fastify'
import { verifyUser } from '@/infrastructure/auth/verifyUser.js'
import { SupabaseMediaRepository } from '@/infrastructure/repositories/SupabaseMediaRepository.js'
import { UploadMedia } from '@/application/usecases/media/UploadMedia.js'
import { RegisterMedia } from '@/application/usecases/media/RegisterMedia.js'
import { ListMedia } from '@/application/usecases/media/ListMedia.js'
import { DeleteMedia } from '@/application/usecases/media/DeleteMedia.js'
import { MediaType } from '@/domain/repositories/MediaRepository.js'

const repo = new SupabaseMediaRepository()

export async function MediaController(app: FastifyInstance) {
  // Generar URL firmada para subida directa a Supabase Storage
  app.post('/clients/:clientId/media/upload-url', async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { clientId } = req.params as { clientId: string }
    const { filename, media_type } = req.body as { filename: string; media_type: MediaType }

    const usecase = new UploadMedia(repo)
    const result = await usecase.execute(user.id, clientId, filename, media_type ?? 'image')
    return reply.send(result)
  })

  // Registrar asset en client_media tras subida directa exitosa
  app.post('/clients/:clientId/media/register', async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { clientId } = req.params as { clientId: string }
    const { storage_path, filename, media_type, file_size_bytes } = req.body as {
      storage_path: string
      filename: string
      media_type: MediaType
      file_size_bytes?: number
    }

    const usecase = new RegisterMedia(repo)
    const result = await usecase.execute(
      user.id,
      clientId,
      storage_path,
      filename,
      media_type,
      file_size_bytes
    )
    return reply.status(201).send(result)
  })

  // Listar todos los creativos de una marca
  app.get('/clients/:clientId/media', async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { clientId } = req.params as { clientId: string }

    const usecase = new ListMedia(repo)
    const media = await usecase.execute(user.id, clientId)
    return reply.send(media)
  })

  // Eliminar un creativo de la biblioteca de la marca
  app.delete('/clients/:clientId/media/:mediaId', async (req, reply) => {
    const user = await verifyUser(req, reply)
    const { clientId, mediaId } = req.params as { clientId: string; mediaId: string }

    const usecase = new DeleteMedia(repo)
    await usecase.execute(user.id, clientId, mediaId)
    return reply.send({ success: true })
  })
}
