# Script para diagnosticar problemas de login
param(
    [Parameter(Mandatory=$true)]
    [string]$Email,
    
    [Parameter(Mandatory=$true)]
    [string]$Password
)

$baseUrl = "http://localhost:3000"

Write-Host "🔍 Diagnosticando problema de login..." -ForegroundColor Cyan
Write-Host "Email: $Email" -ForegroundColor Yellow
Write-Host ""

# Intentar login
Write-Host "1️⃣ Intentando hacer login..." -ForegroundColor Cyan
try {
    $loginBody = @{
        email = $Email
        password = $Password
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/v1/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody `
        -ErrorAction Stop

    Write-Host "✅ Login exitoso!" -ForegroundColor Green
    Write-Host "Token obtenido: $($response.access_token.Substring(0, 20))..." -ForegroundColor Green
    Write-Host ""
    Write-Host "Usuario:" -ForegroundColor Cyan
    $response.user | ConvertTo-Json | Write-Host
    
    exit 0
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    $errorMessage = if ($errorResponse) { $errorResponse.error } else { $_.Exception.Message }
    
    Write-Host "❌ Error en login: $errorMessage" -ForegroundColor Red
    Write-Host ""
    
    # Diagnosticar el tipo de error
    if ($errorMessage -like "*confirm*" -or $errorMessage -like "*confirmación*") {
        Write-Host "🔍 DIAGNÓSTICO: La cuenta necesita confirmación de email" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "SOLUCIÓN 1: Verifica tu email y haz clic en el link de confirmación" -ForegroundColor Cyan
        Write-Host "SOLUCIÓN 2: En Supabase Dashboard, ve a Authentication > Users" -ForegroundColor Cyan
        Write-Host "           y marca 'Email Confirmed' para tu usuario" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "SOLUCIÓN 3: Deshabilita la confirmación de email temporalmente:" -ForegroundColor Cyan
        Write-Host "           1. Ve a Supabase Dashboard" -ForegroundColor White
        Write-Host "           2. Authentication > Settings" -ForegroundColor White
        Write-Host "           3. Desactiva 'Enable email confirmations'" -ForegroundColor White
    } elseif ($errorMessage -like "*invalid*" -or $errorMessage -like "*inválid*") {
        Write-Host "🔍 DIAGNÓSTICO: Credenciales incorrectas" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "SOLUCIÓN: Verifica que el email y password sean correctos" -ForegroundColor Cyan
        Write-Host ""
        Write-Host "Si olvidaste tu password, puedes:" -ForegroundColor Yellow
        Write-Host "  1. Resetearla desde Supabase Dashboard" -ForegroundColor White
        Write-Host "  2. O usar: Supabase Dashboard > Authentication > Users > Reset Password" -ForegroundColor White
    } else {
        Write-Host "🔍 DIAGNÓSTICO: Error desconocido" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "SOLUCIÓN: Revisa los logs del servidor para más detalles" -ForegroundColor Cyan
    }
    
    Write-Host ""
    Write-Host "💡 ALTERNATIVA: Crear una cuenta nueva para pruebas" -ForegroundColor Cyan
    Write-Host "   .\scripts\create-test-user.ps1 -Email 'test@example.com' -Password 'password123'" -ForegroundColor White
    
    exit 1
}

