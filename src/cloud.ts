import { z } from 'zod'
import { App as AndroidApp } from '@capacitor/app'
import type { Store } from './model'
import { isAndroidApp } from './platform'

export const cloudBase = 'https://wordflow.43.134.190.112.sslip.io'
/** Build-time fallback for the browser preview. On Android the installed version comes from the
 * package itself (see installedRelease), so it can never drift from the APK actually running. */
export const appRelease = { versionCode: 34, versionName: '0.4.4' }
export type InstalledRelease = { versionCode: number; versionName: string; source: 'package' | 'preview' }
export async function installedRelease(): Promise<InstalledRelease> {
  if (!isAndroidApp) return { ...appRelease, source: 'preview' }
  const info = await AndroidApp.getInfo()
  const versionCode = Number(info.build)
  if (!info.version || !Number.isInteger(versionCode) || versionCode <= 0) throw new Error('无法读取当前安装的版本，请稍后重试')
  return { versionCode, versionName: info.version, source: 'package' }
}
const accountKey = 'wordflow-cloud-account'
const revisionKey = 'wordflow-cloud-revision'

export type CloudAccount = { accountId: string; token: string }
type CloudMeta = { revision: number; savedAt: string | null }
export class CloudConflict extends Error {
  revision: number
  savedAt: string | null
  constructor(revision: number, savedAt: string | null) {
    super('云端有更新的记录')
    this.revision = revision
    this.savedAt = savedAt
  }
}

export function loadCloudAccount(): CloudAccount | null {
  try {
    const raw = localStorage.getItem(accountKey)
    if (!raw) return null
    const parsed = JSON.parse(raw) as CloudAccount
    return parsed.accountId && parsed.token ? parsed : null
  } catch { return null }
}
export function saveCloudAccount(account: CloudAccount | null) {
  if (!account) localStorage.removeItem(accountKey)
  else localStorage.setItem(accountKey, JSON.stringify(account))
}
export function loadCloudRevision(): number {
  const value = Number(localStorage.getItem(revisionKey) || 0)
  return Number.isFinite(value) ? value : 0
}
function saveCloudRevision(revision: number) {
  localStorage.setItem(revisionKey, String(revision))
}

async function cloudFetch(path: string, options: RequestInit = {}, token?: string) {
  const response = await fetch(`${cloudBase}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  })
  const data = await response.json().catch(() => ({}))
  if (response.status === 409) throw new CloudConflict(data.revision || 0, data.savedAt || null)
  if (!response.ok) throw new Error(data.error || '云端暂时连不上')
  return data
}

export async function createCloudAccount() {
  const data = await cloudFetch('/v1/accounts', { method: 'POST', body: '{}' })
  const account = { accountId: data.accountId as string, token: data.token as string }
  saveCloudAccount(account)
  saveCloudRevision(0)
  return { ...account, recoveryCode: data.recoveryCode as string }
}
export async function recoverCloudAccount(recoveryCode: string) {
  const data = await cloudFetch('/v1/recover', { method: 'POST', body: JSON.stringify({ recoveryCode }) })
  const account = { accountId: data.accountId as string, token: data.token as string }
  saveCloudAccount(account)
  const meta = await cloudFetch('/v1/state/meta', {}, account.token) as CloudMeta
  saveCloudRevision(meta.revision || 0)
  return account
}
export async function cloudStatus() {
  const account = loadCloudAccount()
  if (!account) return { accountId: null as string | null, revision: 0, savedAt: null as string | null }
  const meta = await cloudFetch('/v1/state/meta', {}, account.token) as CloudMeta
  saveCloudRevision(meta.revision || 0)
  return { accountId: account.accountId, revision: meta.revision || 0, savedAt: meta.savedAt }
}
export async function uploadCloudState(state: Store, force = false) {
  const account = loadCloudAccount()
  if (!account) throw new Error('还没有开通云端保存')
  const data = await cloudFetch('/v1/state', {
    method: 'PUT',
    body: JSON.stringify({ state, baseRevision: loadCloudRevision(), force }),
  }, account.token)
  saveCloudRevision(data.revision)
  return { revision: data.revision as number, savedAt: data.savedAt as string }
}
export async function downloadCloudState() {
  const account = loadCloudAccount()
  if (!account) throw new Error('还没有开通云端保存')
  const data = await cloudFetch('/v1/state', {}, account.token)
  saveCloudRevision(data.revision || 0)
  return data.state as unknown
}
export type CloudRelease = { versionCode: number; versionName: string; url: string; notes: string; sha256: string }
const releaseSchema = z.object({
  versionCode: z.number().int().nonnegative(), versionName: z.string().trim().min(1).max(40),
  url: z.string().url(), notes: z.string().max(2000), sha256: z.string().regex(/^[0-9a-f]{64}$/i),
})
export async function fetchCloudRelease(): Promise<CloudRelease> {
  return releaseSchema.parse(await cloudFetch('/v1/release'))
}
