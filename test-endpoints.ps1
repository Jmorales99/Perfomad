# test-endpoints.ps1
# Script para probar los endpoints de la API

param(
    [string]$Email = "tu-email@example.com",
    [string]$Password = "tu-password"
)

$baseUrl = "http://localhost:3000"

Write-Host "🔐 Obteniendo token de autenticación..." -ForegroundColor Cyan

# Login
$loginBody = @{
    email = $Email
    password = $Password
} | ConvertTo-Json

try {
    $loginResponse = Invoke-RestMethod -Uri "$baseUrl/v1/auth/login" `
        -Method POST `
        -ContentType "application/json" `
        -Body $loginBody

    $token = $loginResponse.access_token
    Write-Host "✅ Token obtenido!" -ForegroundColor Green
    Write-Host ""
} catch {
    Write-Host "❌ Error al hacer login: $_" -ForegroundColor Red
    Write-Host "Asegúrate de que:" -ForegroundColor Yellow
    Write-Host "  1. El servidor esté corriendo en http://localhost:3000" -ForegroundColor Yellow
    Write-Host "  2. Las credenciales sean correctas" -ForegroundColor Yellow
    Write-Host "  3. El usuario exista en la base de datos" -ForegroundColor Yellow
    exit 1
}

$headers = @{
    Authorization = "Bearer $token"
}

# Test 1: Platform Summary
Write-Host "📊 Probando GET /v1/platforms/summary..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/platforms/summary" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 2: Meta Metrics
Write-Host "📊 Probando GET /v1/platforms/meta/metrics..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/platforms/meta/metrics" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 3: Google Ads Metrics
Write-Host "📊 Probando GET /v1/platforms/google_ads/metrics..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/platforms/google_ads/metrics" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 4: Meta Insights
Write-Host "💡 Probando GET /v1/platforms/meta/insights..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/platforms/meta/insights" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 5: Dashboard Platform Summary
Write-Host "📈 Probando GET /v1/dashboard/platform-summary..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/dashboard/platform-summary" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

# Test 6: Dashboard Metrics
Write-Host "📈 Probando GET /v1/dashboard/metrics..." -ForegroundColor Yellow
try {
    $response = Invoke-RestMethod -Uri "$baseUrl/v1/dashboard/metrics" `
        -Method GET `
        -Headers $headers
    Write-Host "✅ Éxito!" -ForegroundColor Green
    $response | ConvertTo-Json -Depth 5 | Write-Host
} catch {
    Write-Host "❌ Error: $_" -ForegroundColor Red
}
Write-Host ""

Write-Host "✨ Pruebas completadas!" -ForegroundColor Cyan

