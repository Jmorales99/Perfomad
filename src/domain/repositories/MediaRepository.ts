export type MediaType = 'image' | 'video'

export interface MediaData {
  id: string
  filename: string
  storagePath: string
  mediaType: MediaType
  url: string
  fileSizeBytes: number | null
  createdAt: string
}

export interface MediaRepository {
  generateSignedUploadUrl(
    userId: string,
    clientId: string,
    filename: string,
    mediaType: MediaType
  ): Promise<{ uploadUrl: string; storagePath: string }>

  registerMedia(
    userId: string,
    clientId: string,
    storagePath: string,
    filename: string,
    mediaType: MediaType,
    fileSizeBytes?: number
  ): Promise<MediaData>

  listClientMedia(userId: string, clientId: string): Promise<MediaData[]>

  deleteMedia(userId: string, clientId: string, mediaId: string): Promise<void>

  findByStoragePath(storagePath: string): Promise<{ clientId: string; userId: string } | null>
}
