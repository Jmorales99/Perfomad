# 🎯 Frontend Error Handling Guide

## Error Response Format

When the API returns an error (status 400+), it follows this structure:

```typescript
interface ErrorResponse {
  error: string                    // Error code (e.g., "NO_AD_ACCOUNTS", "MISSING_PLATFORM_ACCOUNTS")
  message: string                  // User-friendly message
  title?: string                   // Modal title
  details?: string                 // Additional details
  action_required?: string         // What user needs to do
  help_url?: string                // URL to help/settings page
  action_button_text?: string      // Text for action button
  show_popup?: boolean             // Flag to show popup/modal
  missing_platforms?: string[]     // Array of missing platforms
  missing_platform_names?: string[] // Human-readable platform names
}
```

## Example Error Responses

### No Ad Accounts Connected

```json
{
  "error": "NO_AD_ACCOUNTS",
  "message": "⚠️ No tienes cuentas de publicidad conectadas",
  "title": "Cuentas de publicidad requeridas",
  "details": "Para crear campañas, primero debes conectar al menos una cuenta de publicidad.",
  "action_required": "Conecta tus cuentas de publicidad",
  "help_url": "/subscription/accounts",
  "action_button_text": "Conectar cuentas ahora",
  "show_popup": true
}
```

### Missing Platform-Specific Accounts

```json
{
  "error": "MISSING_PLATFORM_ACCOUNTS",
  "message": "⚠️ Cuentas de publicidad no conectadas",
  "title": "Cuentas requeridas para esta plataforma",
  "details": "Para crear campañas en Meta (Facebook/Instagram), primero debes conectar tu cuenta de publicidad.",
  "missing_platforms": ["meta"],
  "missing_platform_names": ["Meta (Facebook/Instagram)"],
  "action_required": "Conecta tu cuenta de Meta (Facebook/Instagram)",
  "help_url": "/subscription/accounts",
  "action_button_text": "Conectar cuentas ahora",
  "show_popup": true
}
```

## Frontend Implementation Example

### React/TypeScript Example

```typescript
// Error handling utility
interface ApiError {
  error: string
  message: string
  title?: string
  details?: string
  action_required?: string
  help_url?: string
  action_button_text?: string
  show_popup?: boolean
  missing_platforms?: string[]
}

// In your campaign creation component
async function handleCreateCampaign(campaignData: any) {
  try {
    const response = await fetch('/v1/campaigns', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(campaignData)
    })

    if (!response.ok) {
      const error: ApiError = await response.json()
      
      // Show popup/modal for ad account errors
      if (error.show_popup || error.error === 'NO_AD_ACCOUNTS' || error.error === 'MISSING_PLATFORM_ACCOUNTS') {
        showAccountConnectionModal(error)
        return
      }
      
      // Show regular error toast for other errors
      showErrorToast(error.message)
      return
    }

    const campaign = await response.json()
    // Success - redirect or update UI
    navigate(`/campaigns/${campaign.id}`)
    
  } catch (err) {
    showErrorToast('Error al crear campaña. Intenta nuevamente.')
  }
}

// Modal component
function AccountConnectionModal({ error, onClose }: { error: ApiError, onClose: () => void }) {
  return (
    <Modal
      open={true}
      onClose={onClose}
      title={error.title || error.message}
    >
      <div className="modal-content">
        <p>{error.details}</p>
        
        {error.missing_platform_names && (
          <div className="missing-platforms">
            <strong>Plataformas requeridas:</strong>
            <ul>
              {error.missing_platform_names.map(platform => (
                <li key={platform}>{platform}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onClose}>Cancelar</button>
          <button 
            onClick={() => {
              navigate(error.help_url || '/subscription/accounts')
              onClose()
            }}
            className="primary"
          >
            {error.action_button_text || 'Conectar cuentas'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
```

### Vue.js Example

```vue
<template>
  <div>
    <!-- Campaign form -->
    
    <!-- Error Modal -->
    <Modal v-if="showErrorModal" @close="showErrorModal = false">
      <h2>{{ errorData.title || errorData.message }}</h2>
      <p>{{ errorData.details }}</p>
      
      <ul v-if="errorData.missing_platform_names">
        <li v-for="platform in errorData.missing_platform_names" :key="platform">
          {{ platform }}
        </li>
      </ul>
      
      <button @click="navigateToAccounts">Conectar cuentas</button>
    </Modal>
  </div>
</template>

<script setup>
import { ref } from 'vue'

const showErrorModal = ref(false)
const errorData = ref({})

async function createCampaign(formData) {
  try {
    const response = await fetch('/v1/campaigns', {
      method: 'POST',
      body: JSON.stringify(formData)
    })
    
    if (!response.ok) {
      const error = await response.json()
      
      if (error.show_popup || error.error === 'NO_AD_ACCOUNTS') {
        errorData.value = error
        showErrorModal.value = true
        return
      }
      
      alert(error.message)
    }
    
    // Success handling
  } catch (err) {
    alert('Error al crear campaña')
  }
}

function navigateToAccounts() {
  window.location.href = errorData.value.help_url || '/subscription/accounts'
}
</script>
```

## Pre-Check Before Showing Form

You can also check if user can create campaigns before showing the form:

```typescript
async function checkCanCreate() {
  try {
    const response = await fetch('/v1/campaigns/can-create')
    const status = await response.json()
    
    if (!status.can_create) {
      // Show message or redirect
      if (status.ad_accounts_count === 0) {
        showModal({
          title: "Conecta tus cuentas",
          message: "Necesitas conectar cuentas de publicidad para crear campañas",
          action: () => navigate('/subscription/accounts')
        })
      }
      return false
    }
    
    return true
  } catch (err) {
    console.error(err)
    return false
  }
}

// Use it before showing campaign form
if (await checkCanCreate()) {
  showCampaignForm()
} else {
  showAccountConnectionPrompt()
}
```

## Error Codes Reference

| Error Code | Description | Action |
|------------|-------------|--------|
| `NO_AD_ACCOUNTS` | User has no ad accounts connected | Show "Connect Accounts" modal |
| `MISSING_PLATFORM_ACCOUNTS` | Missing accounts for selected platforms | Show platform-specific connection modal |
| `NO_SUBSCRIPTION` | User doesn't have active subscription | Redirect to subscription page |

