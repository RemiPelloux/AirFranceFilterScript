import { Coins, ExternalLink, RefreshCw } from 'lucide-react'
import { useState } from 'react'

interface AuthPromptProps {
  visible: boolean
  onRetry: () => void
}

export function AuthPrompt({ visible, onRetry }: AuthPromptProps) {
  const [opening, setOpening] = useState(false)
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState<string>(
    'Une fenêtre Chrome a été ouverte — connectez-vous à Flying Blue, puis continuez.',
  )

  if (!visible) return null

  const openLogin = async () => {
    setOpening(true)
    setMessage('Ouverture de la connexion Air France…')
    try {
      const response = await fetch('/api/auth/open', { method: 'POST' })
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string }
      setMessage(response.ok
        ? (payload.message ?? 'Fenêtre Chrome ouverte — connectez-vous à Flying Blue.')
        : (payload.error ?? 'Impossible d’ouvrir Chrome.'))
    } catch {
      setMessage('Impossible d’ouvrir la fenêtre de connexion Air France.')
    } finally {
      setOpening(false)
    }
  }

  const verifyAndRetry = async () => {
    setChecking(true)
    setMessage('Vérification de la session Flying Blue…')
    try {
      const response = await fetch('/api/auth/status')
      const payload = await response.json() as { authenticated?: boolean; error?: string }
      if (payload.authenticated) {
        onRetry()
        return
      }
      setMessage(payload.error ?? 'Toujours déconnecté — terminez la connexion dans Chrome, puis réessayez.')
    } catch {
      setMessage('Vérification impossible — relancez après vous être connecté.')
    } finally {
      setChecking(false)
    }
  }

  return (
    <section className="auth-prompt" aria-label="Connexion Flying Blue">
      <div className="auth-prompt-copy">
        <Coins size={18} />
        <div>
          <strong>Connexion Flying Blue requise</strong>
          <span>{message}</span>
        </div>
      </div>
      <div className="auth-prompt-actions">
        <button type="button" onClick={() => void openLogin()} disabled={opening}>
          <ExternalLink size={14} /> {opening ? 'Ouverture…' : 'Ouvrir la connexion'}
        </button>
        <button type="button" className="primary" onClick={() => void verifyAndRetry()} disabled={checking}>
          <RefreshCw size={14} className={checking ? 'spin' : undefined} />
          {checking ? 'Vérification…' : 'J’ai terminé — continuer'}
        </button>
      </div>
    </section>
  )
}
