#!/usr/bin/env node

/**
 * Script para generar TOKEN_ENCRYPTION_KEY
 * 
 * Uso:
 *   node scripts/generate-encryption-key.js
 *   node scripts/generate-encryption-key.js --env production
 */

import crypto from 'node:crypto';

function generateKey() {
  // Genera 32 bytes aleatorios (256 bits) para AES-256
  const key = crypto.randomBytes(32);
  
  // Convierte a Base64 para fácil almacenamiento en .env
  return key.toString('base64');
}

function validateKey(key) {
  try {
    const buffer = Buffer.from(key, 'base64');
    if (buffer.length !== 32) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

function main() {
  const args = process.argv.slice(2);
  const isProduction = args.includes('--env') && args[args.indexOf('--env') + 1] === 'production';
  
  console.log('\n🔐 Generador de TOKEN_ENCRYPTION_KEY\n');
  console.log('═══════════════════════════════════════\n');
  
  if (isProduction) {
    console.log('⚠️  MODO PRODUCCIÓN\n');
    console.log('⚠️  IMPORTANTE: Guarda esta clave de forma segura:');
    console.log('   - Usa un gestor de secretos (AWS Secrets Manager, HashiCorp Vault, etc.)');
    console.log('   - NO la commitees en Git');
    console.log('   - NO la compartas por email/chat');
    console.log('   - Haz backup seguro\n');
  } else {
    console.log('📝 MODO DESARROLLO\n');
    console.log('Esta clave es para tu entorno local.\n');
  }
  
  const key = generateKey();
  
  console.log('✅ Clave generada:');
  console.log('─────────────────────────────────────');
  console.log(`TOKEN_ENCRYPTION_KEY=${key}`);
  console.log('─────────────────────────────────────\n');
  
  console.log('📋 Verificación:');
  console.log(`   Longitud: ${key.length} caracteres (Base64)`);
  console.log(`   Bytes: ${Buffer.from(key, 'base64').length} bytes`);
  console.log(`   Válida: ${validateKey(key) ? '✅ Sí' : '❌ No'}\n`);
  
  console.log('📝 Agrega esto a tu archivo .env:\n');
  console.log(`TOKEN_ENCRYPTION_KEY=${key}\n`);
  
  if (isProduction) {
    console.log('🔒 RECUERDA:');
    console.log('   1. Guarda esta clave en tu gestor de secretos');
    console.log('   2. Configúrala como variable de entorno en tu servidor');
    console.log('   3. Haz backup seguro de la clave\n');
  } else {
    console.log('💡 TIP: Para producción, genera otra clave diferente con:');
    console.log('   node scripts/generate-encryption-key.js --env production\n');
  }
  
  console.log('═══════════════════════════════════════\n');
}

main();

