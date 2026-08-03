import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getBrowserContext } from './browser.js'

interface ExportedCookie {
  name?: unknown
  value?: unknown
  domain?: unknown
  path?: unknown
  expirationDate?: unknown
  httpOnly?: unknown
  secure?: unknown
  sameSite?: unknown
}

interface BrowserCookie {
  name: string
  value: string
  domain: string
  path: string
  expires?: number
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

const sameSiteFromExport = (value: unknown): BrowserCookie['sameSite'] => {
  if (typeof value !== 'string') return undefined
  if (value.toLowerCase() === 'strict') return 'Strict'
  if (value.toLowerCase() === 'lax') return 'Lax'
  if (value.toLowerCase() === 'none' || value.toLowerCase() === 'no_restriction') return 'None'
  return undefined
}

const cookieFromExport = (cookie: ExportedCookie): BrowserCookie | undefined => {
  if (typeof cookie.name !== 'string' || typeof cookie.value !== 'string' || typeof cookie.domain !== 'string') {
    return undefined
  }
  if (!cookie.domain.toLowerCase().endsWith('airfrance.fr')) return undefined
  const expirationDate = typeof cookie.expirationDate === 'number' && cookie.expirationDate > Date.now() / 1000
    ? cookie.expirationDate
    : undefined
  return {
    name: cookie.name,
    value: cookie.value,
    domain: cookie.domain,
    path: typeof cookie.path === 'string' ? cookie.path : '/',
    ...(expirationDate ? { expires: expirationDate } : {}),
    ...(typeof cookie.httpOnly === 'boolean' ? { httpOnly: cookie.httpOnly } : {}),
    ...(typeof cookie.secure === 'boolean' ? { secure: cookie.secure } : {}),
    ...(sameSiteFromExport(cookie.sameSite) ? { sameSite: sameSiteFromExport(cookie.sameSite) } : {}),
  }
}

export const importFlyingBlueSession = async (cookieFile: string): Promise<number> => {
  const raw = JSON.parse(await readFile(resolve(cookieFile), 'utf8')) as unknown
  if (!Array.isArray(raw)) throw new Error('Le fichier de cookies doit contenir un tableau JSON')
  const cookies = raw.flatMap((entry): BrowserCookie[] => {
    if (!entry || typeof entry !== 'object') return []
    const cookie = cookieFromExport(entry as ExportedCookie)
    return cookie ? [cookie] : []
  })
  if (!cookies.length) throw new Error('Aucun cookie Air France valide dans le fichier')
  const context = await getBrowserContext()
  await context.addCookies(cookies)
  return cookies.length
}
