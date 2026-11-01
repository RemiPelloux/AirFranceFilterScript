import { Coins, ExternalLink, LogIn } from 'lucide-react'
import { useState } from 'react'

interface AuthPromptProps {
  visible: boolean
  onConfirmed: () => void
}

export function AuthPrompt({ visible, onConfirmed }: AuthPromptProps) {
  const [opening, setOpening] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState(
    'Connectez-vous dans Chrome, puis cliquez « Je suis connecté » pour récupérer la session.',
  )

  if (!visible) return null

  const openLogin = async () => {
    setOpening(true)
    setMessage('Ouverture de Chrome sur la page Flying Blue…')
    try {
      const response = await fetch('/api/auth/open', { method: 'POST' })
      const payload = await response.json() as { ok?: boolean; message?: string; error?: string }
      setMessage(response.ok
        ? (payload.message ?? 'Chrome ouvert — connectez-vous, puis validez ici.')
        : (payload.error ?? 'Impossible d’ouvrir Chrome.'))
    } catch {
      setMessage('Impossible d’ouvrir la fenêtre de connexion Air France.')
    } finally {
      setOpening(false)
    }
  }

  const confirmSignIn = async () => {
    setConfirming(true)
    setMessage('Récupération des cookies Flying Blue…')
    try {
      const response = await fetch('/api/auth/confirm', { method: 'POST' })
      const payload = await response.json() as {
        ok?: boolean
        authenticated?: boolean
        cookieCount?: number
        message?: string
        error?: string
      }
      if (response.ok && payload.authenticated) {
        setMessage(payload.message ?? 'Session Flying Blue prête.')
        onConfirmed()
        return
      }
      setMessage(payload.error ?? 'Toujours déconnecté — terminez la connexion dans Chrome.')
    } catch {
      setMessage('Confirmation impossible — réessayez après vous être connecté.')
    } finally {
      setConfirming(false)
    }
  }

  return (
    <section className="auth-prompt" aria-label="Connexion Flying Blue">
      <div className="auth-prompt-copy">
        <Coins size={18} />
        <div>
          <strong>Connexion Flying Blue</strong>
          <span>{message}</span>
        </div>
      </div>
      <div className="auth-prompt-actions">
        <button type="button" onClick={() => void openLogin()} disabled={opening || confirming}>
          <ExternalLink size={14} /> {opening ? 'Ouverture…' : 'Ouvrir Chrome'}
        </button>
        <button type="button" className="primary" onClick={() => void confirmSignIn()} disabled={confirming || opening}>
          <LogIn size={14} /> {confirming ? 'Récupération…' : 'Je suis connecté'}
        </button>
      </div>
    </section>
  )
}
