export interface ImageData {
  name: string
  path: string
  url: string
}

export interface ImagesRepository {
  generateSignedUploadUrl(userId: string, filename: string): Promise<{ uploadUrl: string; path: string }>
  listUserImages(userId: string): Promise<ImageData[]>
  deleteImage(userId: string, filename: string): Promise<void>
}
