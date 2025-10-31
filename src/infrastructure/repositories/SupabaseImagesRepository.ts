import { supabaseAdmin } from '@/infrastructure/db/supabaseClient'
import { ImagesRepository, ImageData } from '@/domain/repositories/ImagesRepository'

export class SupabaseImagesRepository implements ImagesRepository {
  private readonly bucket = 'perfomad-images'

  async generateSignedUploadUrl(userId: string, filename: string) {
    const filePath = `user_${userId}/${Date.now()}_${filename}`
    const { data, error } = await supabaseAdmin
      .storage
      .from(this.bucket)
      .createSignedUploadUrl(filePath)

    if (error) throw new Error(`Error al generar URL firmada: ${error.message}`)
    return { uploadUrl: data.signedUrl, path: filePath }
  }

  async listUserImages(userId: string): Promise<ImageData[]> {
    const { data, error } = await supabaseAdmin
      .storage
      .from(this.bucket)
      .list(`user_${userId}`)

    if (error) throw new Error(`Error al listar imágenes: ${error.message}`)

    const signedUrls = await Promise.all(
      data.map(async (file) => {
        const { data: signed } = await supabaseAdmin
          .storage
          .from(this.bucket)
          .createSignedUrl(`user_${userId}/${file.name}`, 60 * 60)
        return {
          name: file.name,
          path: `user_${userId}/${file.name}`,
          url: signed?.signedUrl || ''
        }
      })
    )

    return signedUrls
  }

  async deleteImage(userId: string, filename: string): Promise<void> {
    const { error } = await supabaseAdmin
      .storage
      .from(this.bucket)
      .remove([`user_${userId}/${filename}`])

    if (error) throw new Error(`Error al eliminar imagen: ${error.message}`)
  }
}
