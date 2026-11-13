// Ponte CRM <-> Google Agenda da Rovya.
// POST (com o login da admin): {acao:'url'|'listar'|'criar'|'editar'|'apagar'|'desconectar', ...}
// GET: volta do consentimento do Google (?code&state), guarda o refresh token e redireciona para o CRM.
// Deploy com verify_jwt = false (o GET vem do Google sem login); o POST confere o login aqui dentro.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '', CSEC = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const REDIRECT = `${SUPA}/functions/v1/crm-google`;
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
const db = createClient(SUPA, SR, { auth: { persistSession: false } });

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, GET, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const b64 = (s: string) => btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deb64 = (s: string) => decodeURIComponent(escape(atob(s.replace(/-/g, '+').replace(/_/g, '/'))));

async function assina(s: string) {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(SR), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(s)))));
}

async function eAdmin(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!t) return false;
  const { data: { user } } = await db.auth.getUser(t);
  if (!user?.email) return false;
  const { data } = await db.from('admins').select('email').eq('email', user.email).maybeSingle();
  return !!data;
}

async function tokenGoogle() {
  const { data } = await db.from('crm_google').select('email,refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: data.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) { if (j.error === 'invalid_grant') await db.from('crm_google').delete().eq('id', 1); return null; } // autorização revogada: pede de novo
  return { token: j.access_token as string, email: data.email as string };
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (!CID || !CSEC) return json({ erro: 'Google Agenda ainda não configurado (faltam GOOGLE_CLIENT_ID/SECRET).' }, 503);

  // volta do Google
  if (req.method === 'GET') {
    const u = new URL(req.url), code = u.searchParams.get('code');
    const [volta64, exp, sig] = (u.searchParams.get('state') || '').split('.');
    if (!code || !sig || sig !== await assina(`${volta64}.${exp}`) || Date.now() > Number(exp)) return new Response('Link inválido ou expirado. Volte ao CRM e tente de novo.', { status: 400 });
    const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ code, client_id: CID, client_secret: CSEC, redirect_uri: REDIRECT, grant_type: 'authorization_code' }) });
    const j = await r.json();
    if (!r.ok || !j.refresh_token) return new Response('O Google não autorizou: ' + (j.error_description || j.error || 'sem refresh token'), { status: 400 });
    const cal = await (await fetch(CAL + '?maxResults=1', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();
    await db.from('crm_google').upsert({ id: 1, email: cal.summary ?? null, refresh_token: j.refresh_token, conectado_em: new Date().toISOString() });
    return Response.redirect(deb64(volta64), 302);
  }

  if (!await eAdmin(req)) return json({ erro: 'Sem permissão' }, 401);
  const b = await req.json().catch(() => ({}));

  if (b.acao === 'url') {
    const volta = String(b.volta || '');
    if (!/^(https:\/\/|http:\/\/localhost[:/]|http:\/\/127\.0\.0\.1[:/])/.test(volta)) return json({ erro: 'Endereço de volta inválido' }, 400);
    const exp = String(Date.now() + 10 * 60e3), v = b64(volta);
    const state = `${v}.${exp}.${await assina(`${v}.${exp}`)}`;
    return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
      client_id: CID, redirect_uri: REDIRECT, response_type: 'code', access_type: 'offline', prompt: 'consent', state,
      scope: 'https://www.googleapis.com/auth/calendar.events' }) });
  }
  if (b.acao === 'desconectar') {
    const { data } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
    if (data?.refresh_token) await fetch('https://oauth2.googleapis.com/revoke?token=' + data.refresh_token, { method: 'POST' });
    await db.from('crm_google').delete().eq('id', 1);
    return json({ ok: true });
  }

  const t = await tokenGoogle();
  if (!t) return json({ conectado: false });
  const g = (path: string, init: RequestInit = {}) => fetch(CAL + path, { ...init, headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' } });
  const repassa = async (r: Response) => r.status === 204 ? json({ ok: true }) : r.ok ? json(await r.json()) : json({ erro: (await r.json()).error?.message || 'Erro no Google' }, 502);

  switch (b.acao) {
    case 'listar': {
      const r = await g('?' + new URLSearchParams({ timeMin: new Date(b.de).toISOString(), timeMax: new Date(b.ate).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' }));
      const j = await r.json();
      return r.ok ? json({ conectado: true, email: t.email, eventos: j.items ?? [] }) : json({ erro: j.error?.message }, 502);
    }
    case 'criar': return repassa(await g('', { method: 'POST', body: JSON.stringify(b.evento) }));
    case 'editar': return repassa(await g('/' + encodeURIComponent(b.id), { method: 'PATCH', body: JSON.stringify(b.evento) }));
    case 'apagar': return repassa(await g('/' + encodeURIComponent(b.id), { method: 'DELETE' }));
  }
  return json({ erro: 'Ação desconhecida' }, 400);
});
