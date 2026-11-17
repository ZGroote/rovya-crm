// Ponte CRM <-> Google (Agenda + Drive) da Rovya.
// POST (com o login da admin): {acao:'url'|'listar'|'criar'|'editar'|'apagar'|'desconectar'|'token', ...}
// 'token' devolve um access token de 1 h (escopos calendar.events + drive.file) para o navegador falar direto com o Drive.
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
  // MFA: quem tem fator verificado precisa de sessão aal2 (o token já foi validado pelo getUser)
  const aal = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
  if (user.factors?.some((f: any) => f.status === 'verified') && aal !== 'aal2') return false;
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

// Backup semanal (pg_cron, 014_backup.sql): todas as tabelas do CRM num JSON na pasta "15 — Tecnologia e Sistemas".
// Mesma lista e formato do backup manual (configuracoes.js), então o roteiro de restauração do LEIA-ME vale para os dois.
// Guarda os 12 automáticos mais recentes; os anteriores vão para a lixeira do Drive (recuperáveis por 30 dias).
const TABELAS = ['crm_clientes', 'crm_oportunidades', 'crm_interacoes', 'crm_servicos', 'crm_propostas', 'crm_contratos', 'crm_projetos', 'crm_etapas',
  'crm_entregas', 'crm_anexos', 'crm_tarefas', 'crm_parcelas', 'crm_modelos', 'crm_documentos', 'crm_drive'];
const MANTER = 12, DRIVE = 'https://www.googleapis.com/drive/v3/files';
async function backupSemanal() {
  const falha = async (m: string) => { await db.from('crm_falhas').insert({ origem: 'backup', acao: 'backup semanal', mensagem: m }); return { ok: false, erro: m }; };
  const t = await tokenGoogle();
  if (!t) return falha('O backup automático da semana não foi feito: o Google da Rovya não está conectado (Agenda → Conectar). Enquanto isso, baixe um backup manual em Configurações.');
  const { data: pasta } = await db.from('crm_drive').select('folder_id').eq('chave', '15').maybeSingle();
  if (!pasta?.folder_id) return falha('O backup automático da semana não foi feito: a pasta “15 — Tecnologia e Sistemas” ainda não existe no Drive. Em Documentos, clique em “Conferir estrutura”.');
  const tabelas: Record<string, unknown[]> = {};
  for (const tb of TABELAS) {
    let todos: unknown[] = [];
    for (let de = 0; ; de += 1000) { // de 1000 em 1000 (limite da API)
      const { data, error } = await db.from(tb).select('*').range(de, de + 999);
      if (error) return falha(`O backup automático falhou ao ler ${tb}: ${error.message}`);
      todos = todos.concat(data); if (data.length < 1000) break;
    }
    tabelas[tb] = todos;
  }
  const dia = new Date().toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' }), nome = `ROVYA_BACKUP_${dia}_AUTO.json`;
  const corpo = JSON.stringify({ sistema: 'ROVYA OS', gerado_em: new Date().toISOString(), versao: 1, automatico: true, tabelas }, null, 1);
  const auth = { Authorization: 'Bearer ' + t.token };
  // envio resumível: não tem o limite de 5 MB do envio simples
  const ini = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name', { method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'application/json' }, body: JSON.stringify({ name: nome, parents: [pasta.folder_id] }) });
  const destino = ini.headers.get('Location');
  if (!ini.ok || !destino) return falha(`O backup automático não foi salvo no Drive (${(await ini.json().catch(() => ({}))).error?.message || ini.status}). Baixe um backup manual em Configurações.`);
  const r = await fetch(destino, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: corpo });
  const f = await r.json().catch(() => ({}));
  if (!r.ok || !f.id) return falha(`O backup automático não foi salvo no Drive (${f.error?.message || r.status}). Baixe um backup manual em Configurações.`);
  // rodízio: só os automáticos que o CRM criou nessa pasta (drive.file não enxerga outros arquivos)
  const q = `'${pasta.folder_id}' in parents and name contains '_AUTO.json' and trashed = false`;
  const l = await (await fetch(`${DRIVE}?${new URLSearchParams({ q, orderBy: 'createdTime desc', fields: 'files(id)', pageSize: '100' })}`, { headers: auth })).json().catch(() => ({}));
  for (const velho of (l.files ?? []).slice(MANTER))
    await fetch(`${DRIVE}/${velho.id}`, { method: 'PATCH', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ trashed: true }) });
  return { ok: true, arquivo: f.name, bytes: corpo.length };
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

  // chamada do pg_cron (backup semanal): header x-cron = crm_config.cron_key, a mesma chave do resumo diário
  const cron = req.headers.get('x-cron');
  if (cron) {
    const { data } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
    if (!data?.valor || cron !== data.valor) return json({ erro: 'Sem permissão' }, 401);
    return json(await backupSemanal());
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
      scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/drive.file' }) });
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
    case 'token': { // drive.file só enxerga o que o CRM criou; o token vale 1 h
      const info = await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + t.token)).json();
      return json({ token: t.token, email: t.email, drive: String(info.scope || '').includes('drive.file') });
    }
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
