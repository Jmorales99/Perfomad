import { supabaseAdmin } from '@/infrastructure/db/supabaseClient.js'
import { MediaData, MediaRepository, MediaType } from '@/domain/repositories/MediaRepository.js'

export class SupabaseMediaRepository implements MediaRepository {
  private readonly bucket = 'performad-creatives'

  async generateSignedUploadUrl(
    userId: string,
    clientId: string,
    filename: string,
    _mediaType: MediaType
  ): Promise<{ uploadUrl: string; storagePath: string }> {
    const storagePath = `user_${userId}/client_${clientId}/${Date.now()}_${filename}`
    const { data, error } = await supabaseAdmin
      .storage
      .from(this.bucket)
      .createSignedUploadUrl(storagePath)

    if (error) throw new Error(`Error al generar URL firmada: ${error.message}`)
    return { uploadUrl: data.signedUrl, storagePath }
  }

  async registerMedia(
    userId: string,
    clientId: string,
    storagePath: string,
    filename: string,
    mediaType: MediaType,
    fileSizeBytes?: number
  ): Promise<MediaData> {
    const { data, error } = await supabaseAdmin
      .from('client_media')
      .insert({
        user_id: userId,
        client_id: clientId,
        storage_path: storagePath,
        filename,
        media_type: mediaType,
        file_size_bytes: fileSizeBytes ?? null,
      })
      .select('id, filename, storage_path, media_type, file_size_bytes, created_at')
      .single()

    if (error) throw new Error(`Error al registrar media: ${error.message}`)

    const { data: signed } = await supabaseAdmin
      .storage
      .from(this.bucket)
      .createSignedUrl(storagePath, 60 * 60)

    return {
      id: data.id,
      filename: data.filename,
      storagePath: data.storage_path,
      mediaType: data.media_type as MediaType,
      url: signed?.signedUrl ?? '',
      fileSizeBytes: data.file_size_bytes,
      createdAt: data.created_at,
    }
  }

  async listClientMedia(userId: string, clientId: string): Promise<MediaData[]> {
    const { data, error } = await supabaseAdmin
      .from('client_media')
      .select('id, filename, storage_path, media_type, file_size_bytes, created_at')
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (error) throw new Error(`Error al listar media: ${error.message}`)

    return Promise.all(
      data.map(async (row) => {
        const { data: signed } = await supabaseAdmin
          .storage
          .from(this.bucket)
          .createSignedUrl(row.storage_path, 60 * 60)

        return {
          id: row.id,
          filename: row.filename,
          storagePath: row.storage_path,
          mediaType: row.media_type as MediaType,
          url: signed?.signedUrl ?? '',
          fileSizeBytes: row.file_size_bytes,
          createdAt: row.created_at,
        }
      })
    )
  }

  async deleteMedia(userId: string, clientId: string, mediaId: string): Promise<void> {
    const { data, error: fetchError } = await supabaseAdmin
      .from('client_media')
      .select('storage_path')
      .eq('id', mediaId)
      .eq('user_id', userId)
      .eq('client_id', clientId)
      .single()

    if (fetchError || !data) throw new Error('Media no encontrado o no pertenece a esta marca.')

    await supabaseAdmin.storage.from(this.bucket).remove([data.storage_path])

    const { error } = await supabaseAdmin
      .from('client_media')
      .delete()
      .eq('id', mediaId)

    if (error) throw new Error(`Error al eliminar media: ${error.message}`)
  }

  async findByStoragePath(storagePath: string): Promise<{ clientId: string; userId: string } | null> {
    const { data, error } = await supabaseAdmin
      .from('client_media')
      .select('client_id, user_id')
      .eq('storage_path', storagePath)
      .maybeSingle()

    if (error) throw new Error(`Error al buscar media por path: ${error.message}`)
    if (!data) return null

    return { clientId: data.client_id, userId: data.user_id }
  }
}
