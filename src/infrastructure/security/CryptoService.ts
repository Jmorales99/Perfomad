import crypto from "crypto"

const ALGORITHM = "aes-256-gcm"
const IV_LENGTH = 16 // 128 bits for AES
const SALT_LENGTH = 32
const TAG_LENGTH = 16
const KEY_LENGTH = 32 // 256 bits for AES-256

/**
 * CryptoService handles encryption and decryption of sensitive data
 * Uses AES-256-GCM for authenticated encryption
 */
export class CryptoService {
  private encryptionKey: Buffer

  constructor() {
    const key = process.env.TOKEN_ENCRYPTION_KEY
    if (!key) {
      throw new Error("TOKEN_ENCRYPTION_KEY environment variable is required")
    }

    // Validate key length (must be 32 bytes for AES-256)
    const keyBuffer = Buffer.from(key, "base64")
    if (keyBuffer.length !== KEY_LENGTH) {
      throw new Error(
        `TOKEN_ENCRYPTION_KEY must be ${KEY_LENGTH} bytes (${KEY_LENGTH * 8} bits). Got ${keyBuffer.length} bytes.`
      )
    }

    this.encryptionKey = keyBuffer
  }

  /**
   * Encrypts plaintext data using AES-256-GCM
   * Returns encrypted data, IV, and authentication tag
   */
  encrypt(plaintext: string, accountId: string): { ciphertext: string; iv: string; tag: string } {
    if (!plaintext) {
      throw new Error("Cannot encrypt empty plaintext")
    }

    // Generate random IV for each encryption
    const iv = crypto.randomBytes(IV_LENGTH)

    // Create cipher
    const cipher = crypto.createCipheriv(ALGORITHM, this.encryptionKey, iv)

    // Include account ID as additional authenticated data (AAD)
    // This ensures the encrypted token is bound to the account
    cipher.setAAD(Buffer.from(accountId, "utf8"))

    // Encrypt
    let ciphertext = cipher.update(plaintext, "utf8", "base64")
    ciphertext += cipher.final("base64")

    // Get authentication tag
    const tag = cipher.getAuthTag()

    return {
      ciphertext,
      iv: iv.toString("base64"),
      tag: tag.toString("base64"),
    }
  }

  /**
   * Decrypts encrypted data using AES-256-GCM
   * Verifies authentication tag to ensure data integrity
   */
  decrypt(ciphertext: string, iv: string, tag: string, accountId: string): string {
    if (!ciphertext || !iv || !tag) {
      throw new Error("Cannot decrypt: missing required parameters")
    }

    try {
      // Convert from base64
      const ivBuffer = Buffer.from(iv, "base64")
      const tagBuffer = Buffer.from(tag, "base64")

      // Create decipher
      const decipher = crypto.createDecipheriv(ALGORITHM, this.encryptionKey, ivBuffer)

      // Set authentication tag
      decipher.setAuthTag(tagBuffer)

      // Set AAD (must match encryption)
      decipher.setAAD(Buffer.from(accountId, "utf8"))

      // Decrypt
      let plaintext = decipher.update(ciphertext, "base64", "utf8")
      plaintext += decipher.final("utf8")

      return plaintext
    } catch (error: any) {
      // Don't expose decryption errors to prevent timing attacks
      throw new Error("Decryption failed: invalid or corrupted data")
    }
  }

  /**
   * Generates a cryptographically secure random string
   * Used for OAuth state parameters and other security tokens
   */
  generateSecureRandom(length: number = 32): string {
    if (length < 16) {
      throw new Error("Random string length must be at least 16 bytes for security")
    }

    const randomBytes = crypto.randomBytes(length)
    return randomBytes.toString("base64")
  }

  /**
   * Derives a key from a master key using PBKDF2
   * Can be used for key derivation if needed in the future
   */
  deriveKey(masterKey: string, salt: string): Buffer {
    const saltBuffer = Buffer.from(salt, "base64")
    if (saltBuffer.length !== SALT_LENGTH) {
      throw new Error(`Salt must be ${SALT_LENGTH} bytes`)
    }

    return crypto.pbkdf2Sync(masterKey, saltBuffer, 100000, KEY_LENGTH, "sha256")
  }

  /**
   * Masks a token for logging (shows only first 4 and last 4 characters)
   */
  static maskTokenForLogging(token: string): string {
    if (!token || token.length < 8) {
      return "token_***"
    }
    const start = token.slice(0, 4)
    const end = token.slice(-4)
    return `token_${start}***${end}`
  }
}

