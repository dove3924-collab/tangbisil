// Supabase 공개(publishable) 키는 브라우저에 노출되도록 설계된 값이라 코드에 둬도 된다.
// 보안은 DB의 RLS 정책과 서버 함수가 담당. secret / service_role 키는 절대 여기 두지 말 것.
// 다른 프로젝트로 바꿀 땐 Vercel 환경변수 VITE_SUPABASE_URL / VITE_SUPABASE_KEY로 덮어쓰면 된다.
export const SUPABASE_URL: string =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://cjeinykdiveakcdilrml.supabase.co'
export const SUPABASE_KEY: string =
  import.meta.env.VITE_SUPABASE_KEY ?? 'sb_publishable_LM6F_7Aqg0mPNzZrlHFkwA_Qx026Ahr'
