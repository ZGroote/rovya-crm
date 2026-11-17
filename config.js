import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';

// Projeto Supabase "rovya-stickers" (a chave publicável pode ficar no navegador; quem protege os dados é o RLS)
export const SUPABASE_URL = 'https://jgigosrsyxjqqhckudfe.supabase.co';
// Sem internet, a sessão vencida (mais de 1 h fora) faria cada consulta esperar ~25 s tentando renovar o login.
// Fora do ar, entregamos a sessão salva como se ainda valesse; as consultas saem da cópia do aparelho (sw.js).
// Com internet nada muda: a sessão real é lida e renovada normalmente.
const armazenamento = {
  getItem: k => {
    const v = localStorage.getItem(k);
    if (navigator.onLine || !v || !k.endsWith('-auth-token')) return v;
    try { return JSON.stringify({ ...JSON.parse(v), expires_at: Math.floor(Date.now() / 1000) + 3600 }); } catch { return v; }
  },
  setItem: (k, v) => localStorage.setItem(k, v),
  removeItem: k => localStorage.removeItem(k),
};
export const sb = createClient(SUPABASE_URL, 'sb_publishable_Y7tQfUBPShG6MIeAEChc5Q_3k2wOB0W', { auth: { storage: armazenamento } });
