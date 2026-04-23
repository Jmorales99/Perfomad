# Script para crear un usuario de prueba (sin confirmación de email)
param(
    [Parameter(Mandatory=$false)]
    [string]$Email = "test@example.com",
    
    [Parameter(Mandatory=$false)]
    [string]$Password = "password123",
    
    [Parameter(Mandatory=$false)]
    [string]$Name = "Test User",
    
    [Parameter(Mandatory=$false)]
    [int]$Age = 25,
    
    [Parameter(Mandatory=$false)]
    [string]$Phone = "+1234567890"
)

$baseUrl = "http://localhost:3000"

Write-Host "👤 Creando usuario de prueba..." -ForegroundColor Cyan
Write-Host "Email: $Email" -ForegroundColor Yellow
Write-Host ""

try {
    $signupBody = @{
        email = $Email
        password = $Password
        name = $Name
        age = $Age
        phone = $Phone
    } | ConvertTo-Json

    $response = Invoke-RestMethod -Uri "$baseUrl/v1/auth/signup" `
        -Method POST `
        -ContentType "application/json" `
        -Body $signupBody `
        -ErrorAction Stop

    Write-Host "✅ Usuario creado!" -ForegroundColor Green
    Write-Host $response.message -ForegroundColor Green
    Write-Host ""
    
    if ($response.message -like "*confirm*" -or $response.message -like "*confirmación*") {
        Write-Host "⚠️ IMPORTANTE: Necesitas confirmar el email" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Para desarrollo, puedes:" -ForegroundColor Cyan
        Write-Host "  1. Ir a Supabase Dashboard > Authentication > Users" -ForegroundColor White
        Write-Host "  2. Buscar tu usuario ($Email)" -ForegroundColor White
        Write-Host "  3. Marcar 'Email Confirmed' como true" -ForegroundColor White
        Write-Host ""
        Write-Host "O deshabilitar confirmación de email en:" -ForegroundColor Cyan
        Write-Host "  Supabase Dashboard > Authentication > Settings" -ForegroundColor White
    }
    
    Write-Host ""
    Write-Host "🧪 Ahora puedes probar el login:" -ForegroundColor Cyan
    Write-Host "   .\scripts\test-login.ps1 -Email '$Email' -Password '$Password'" -ForegroundColor White
    
} catch {
    $errorResponse = $_.ErrorDetails.Message | ConvertFrom-Json -ErrorAction SilentlyContinue
    $errorMessage = if ($errorResponse) { $errorResponse.error } else { $_.Exception.Message }
    
    Write-Host "❌ Error al crear usuario: $errorMessage" -ForegroundColor Red
    Write-Host ""
    
    if ($errorMessage -like "*already*" -or $errorMessage -like "*ya existe*") {
        Write-Host "💡 El usuario ya existe. Prueba hacer login:" -ForegroundColor Yellow
        Write-Host "   .\scripts\test-login.ps1 -Email '$Email' -Password '$Password'" -ForegroundColor White
    }
    
    exit 1
}

