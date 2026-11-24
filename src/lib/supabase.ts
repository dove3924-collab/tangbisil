import { createClient } from '@supabase/supabase-js'
import { SUPABASE_KEY, SUPABASE_URL } from './config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, storageKey: 'wollu.auth' },
})

let pending: Promise<string> | null = null

/** 익명 세션 보장. 브라우저에 저장되어 새로고침해도 같은 사람으로 인식된다. */
export function ensureSession(): Promise<string> {
  if (!pending) {
    pending = (async () => {
      const { data } = await supabase.auth.getSession()
      if (data.session) return data.session.user.id
      const { data: signed, error } = await supabase.auth.signInAnonymously()
      if (error || !signed.user) throw error ?? new Error('익명 로그인 실패')
      return signed.user.id
    })().catch((e) => {
      pending = null
      throw e
    })
  }
  return pending
}
