// Ponte CRM <-> Google (Agenda, Drive, Contatos, Gmail) da Rovya.
// POST (com o login da admin): {acao:'url'|'listar'|'criar'|'editar'|'apagar'|'desconectar'|'token'|'agendas'|'salvar_agendas'|'criar_agenda'|'contatos'|'email', ...}
// 'token' devolve um access token de 1 h para o navegador falar direto com o Drive.
// Agendas: 'profissional' (padrão, recebe as reuniões e os agendamentos do site), 'pessoal' e outras só para ver (crm_google.agendas).
// GET: volta do consentimento do Google (?code&state), guarda o refresh token e redireciona para o CRM.
// Deploy com verify_jwt = false (o GET vem do Google sem login); o POST confere o login aqui dentro.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '', CSEC = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const REDIRECT = `${SUPA}/functions/v1/crm-google`;
const CALS = 'https://www.googleapis.com/calendar/v3';
const evUrl = (cal: string) => `${CALS}/calendars/${encodeURIComponent(cal)}/events`;
// escopos pedidos ao conectar; quem conectou antes de algum deles aparece com "Reconectar" no CRM
const ESCOPOS = ['calendar.events', 'calendar.calendarlist.readonly', 'calendar.app.created', 'drive.file', 'contacts.readonly', 'gmail.send'];
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
  const { data } = await db.from('crm_google').select('email,refresh_token,agendas,escopos').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: data.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) { if (j.error === 'invalid_grant') await db.from('crm_google').delete().eq('id', 1); return null; } // autorização revogada: pede de novo
  const a = data.agendas ?? {};
  return { token: j.access_token as string, email: data.email as string, escopos: String(data.escopos ?? ''),
    agendas: { profissional: a.profissional || 'primary', pessoal: a.pessoal || null, mostrar: (a.mostrar || []) as string[] } };
}
const erroGoogle = (j: any) => /insufficient|scope/i.test(j?.error?.message || '') ? 'O Google ainda não deu essa permissão. Em Agenda, clique em “Reconectar Google” e permita tudo.' : (j?.error?.message || 'Erro no Google');
// e-mail (Gmail): cabeçalho com acento vai em base64 (RFC 2047); corpo e anexos em base64 com linhas de 76
const cab = (s: string) => '=?UTF-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
const linhas76 = (s: string) => s.replace(/.{76}/g, '$&\r\n');
function montarEmail(para: string, assunto: string, texto: string, anexos: { nome: string, tipo: string, base64: string }[]) {
  const f = 'rovya' + crypto.randomUUID().replace(/-/g, '');
  const partes = [`Content-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${linhas76(btoa(unescape(encodeURIComponent(texto))))}`,
    ...anexos.map(a => `Content-Type: ${String(a.tipo || 'application/octet-stream').replace(/[^\w.+\/-]/g, '')}; name="${cab(a.nome)}"\r\nContent-Disposition: attachment; filename="${cab(a.nome)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${linhas76(String(a.base64).replace(/[^A-Za-z0-9+\/=]/g, ''))}`)];
  return `To: ${para}\r\nSubject: ${cab(assunto)}\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="${f}"\r\n\r\n` + partes.map(p => `--${f}\r\n${p}\r\n`).join('') + `--${f}--`;
}

// Backup semanal (pg_cron, 014_backup.sql): todas as tabelas do CRM num JSON na pasta "15 — Tecnologia e Sistemas".
// Mesma lista e formato do backup manual (configuracoes.js), então o roteiro de restauração do LEIA-ME vale para os dois.
// Guarda os 12 automáticos mais recentes; os anteriores vão para a lixeira do Drive (recuperáveis por 30 dias).
const TABELAS = ['crm_clientes', 'crm_oportunidades', 'crm_interacoes', 'crm_servicos', 'crm_propostas', 'crm_contratos', 'crm_projetos', 'crm_etapas',
  'crm_entregas', 'crm_anexos', 'crm_tarefas', 'crm_parcelas', 'crm_modelos', 'crm_documentos', 'crm_drive', 'crm_agendamentos', 'crm_links'];
const MANTER = 12, DRIVE = 'https://www.googleapis.com/drive/v3/files';
// pasta do backup: a "15" da estrutura. Se a estrutura ainda não foi criada, cria só a raiz e a 15 (mesmos nomes da tela Documentos),
// e o "Criar estrutura" depois aproveita as duas e cria o resto.
async function pastaBackup(token: string) {
  const { data: ls } = await db.from('crm_drive').select('chave,folder_id,nome').in('chave', ['raiz', '15']);
  const de = (k: string) => (ls ?? []).find((x: any) => x.chave === k);
  if (de('15')?.folder_id) return de('15').folder_id as string;
  const criar = async (name: string, pai?: string) => {
    const r = await fetch(DRIVE + '?fields=id', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: pai ? [pai] : undefined }) });
    const j = await r.json(); if (!j.id) throw new Error(j.error?.message || 'Drive'); return j.id as string;
  };
  const raiz = de('raiz')?.folder_id || await criar('ROVYA — GESTÃO EMPRESARIAL'), nome = de('15')?.nome || '15 — Tecnologia e Sistemas';
  const id = await criar(nome, raiz);
  await db.from('crm_drive').upsert([{ chave: 'raiz', folder_id: raiz, nome: 'ROVYA — GESTÃO EMPRESARIAL' }, { chave: '15', folder_id: id, nome }]);
  return id;
}
async function backupSemanal() {
  const falha = async (m: string) => { await db.from('crm_falhas').insert({ origem: 'backup', acao: 'backup semanal', mensagem: m }); return { ok: false, erro: m }; };
  const t = await tokenGoogle();
  if (!t) return falha('O backup automático da semana não foi feito: o Google da Rovya não está conectado (Agenda → Conectar). Enquanto isso, baixe um backup manual em Configurações.');
  const pasta = { folder_id: await pastaBackup(t.token).catch(() => null) };
  if (!pasta.folder_id) return falha('O backup automático da semana não foi feito: não deu para criar a pasta “15 — Tecnologia e Sistemas” no Drive. Em Documentos, clique em “Conferir estrutura”.');
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
  await db.from('crm_falhas').update({ resolvida: true }).eq('origem', 'backup').eq('resolvida', false);   // backup feito: as falhas de backup anteriores saem da tela (ficam no banco)
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
    const cal = await (await fetch(evUrl('primary') + '?maxResults=1', { headers: { Authorization: 'Bearer ' + j.access_token } })).json();
    await db.from('crm_google').upsert({ id: 1, email: cal.summary ?? null, refresh_token: j.refresh_token, escopos: j.scope ?? null, conectado_em: new Date().toISOString() });
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
      scope: ESCOPOS.map(e => 'https://www.googleapis.com/auth/' + e).join(' ') }) });
  }
  if (b.acao === 'desconectar') {
    const { data } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
    if (data?.refresh_token) await fetch('https://oauth2.googleapis.com/revoke?token=' + data.refresh_token, { method: 'POST' });
    await db.from('crm_google').delete().eq('id', 1);
    return json({ ok: true });
  }

  const t = await tokenGoogle();
  if (!t) return json({ conectado: false });
  const auth = { Authorization: 'Bearer ' + t.token, 'Content-Type': 'application/json' };
  const faltam = ESCOPOS.filter(e => !t.escopos.includes('auth/' + e));
  // 'profissional' / 'pessoal' viram o id da agenda escolhida; sem nada, vai para a profissional
  const agenda = (x: unknown) => x === 'pessoal' ? (t.agendas.pessoal || t.agendas.profissional) : (!x || x === 'profissional') ? t.agendas.profissional : String(x);
  const repassa = async (r: Response) => r.status === 204 ? json({ ok: true }) : r.ok ? json(await r.json()) : json({ erro: erroGoogle(await r.json().catch(() => ({}))) }, 502);
  // Meet precisa de conferenceDataVersion=1; com convidados, o Google manda o convite/atualização por e-mail
  const extras = (ev: any = {}) => '?' + new URLSearchParams({ conferenceDataVersion: '1', sendUpdates: ev.attendees?.length ? 'all' : 'none' });

  switch (b.acao) {
    case 'token': { // drive.file só enxerga o que o CRM criou; o token vale 1 h
      const info = await (await fetch('https://oauth2.googleapis.com/tokeninfo?access_token=' + t.token)).json();
      const { data: chave } = await db.from('crm_config').select('valor').eq('chave', 'google_picker_key').maybeSingle();
      return json({ token: t.token, email: t.email, drive: String(info.scope || '').includes('drive.file'), picker: chave?.valor ? { chave: chave.valor, app: CID.split('-')[0] } : null });
    }
    case 'listar': {
      const a = t.agendas;
      const lista: [string, string][] = [['profissional', a.profissional], ...(a.pessoal ? [['pessoal', a.pessoal] as [string, string]] : []),
        ...a.mostrar.filter(id => id !== a.profissional && id !== a.pessoal).map(id => ['outra', id] as [string, string])];
      const p = new URLSearchParams({ timeMin: new Date(b.de).toISOString(), timeMax: new Date(b.ate).toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '250' });
      if (b.q) p.set('q', String(b.q));
      if (b.prop) p.set('privateExtendedProperty', String(b.prop));
      let erro = '';
      const partes = await Promise.all(lista.map(async ([tipo, id]) => {
        const r = await fetch(evUrl(id) + '?' + p, { headers: auth }); const j = await r.json().catch(() => ({}));
        if (!r.ok) { if (tipo === 'profissional') erro = erroGoogle(j); return []; } // agenda extra que sumiu não derruba a tela
        return (j.items ?? []).map((e: any) => ({ ...e, _tipo: tipo, _agenda: id }));
      }));
      if (erro) return json({ erro }, 502);
      const quando = (e: any) => new Date(e.start?.dateTime || e.start?.date + 'T00:00:00-03:00').getTime();
      return json({ conectado: true, email: t.email, faltam, temPessoal: !!a.pessoal, eventos: partes.flat().sort((x, y) => quando(x) - quando(y)) });
    }
    case 'criar': return repassa(await fetch(evUrl(agenda(b.agenda)) + extras(b.evento), { method: 'POST', headers: auth, body: JSON.stringify(b.evento) }));
    case 'editar': return repassa(await fetch(evUrl(agenda(b.agenda)) + '/' + encodeURIComponent(b.id) + extras(b.evento), { method: 'PATCH', headers: auth, body: JSON.stringify(b.evento) }));
    case 'apagar': return repassa(await fetch(evUrl(agenda(b.agenda)) + '/' + encodeURIComponent(b.id) + '?sendUpdates=all', { method: 'DELETE', headers: auth }));

    case 'agendas': { // agendas da conta (para escolher profissional/pessoal/mostrar)
      const r = await fetch(`${CALS}/users/me/calendarList?minAccessRole=reader`, { headers: auth }); const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ erro: erroGoogle(j) }, 502);
      return json({ faltam, config: t.agendas, lista: (j.items ?? []).map((c: any) => ({ id: c.id, nome: c.summaryOverride || c.summary, principal: !!c.primary, cor: c.backgroundColor, papel: c.accessRole })) });
    }
    case 'salvar_agendas': {
      const a = b.agendas || {};
      const agendas = { profissional: String(a.profissional || 'primary'), pessoal: a.pessoal ? String(a.pessoal) : null, mostrar: (Array.isArray(a.mostrar) ? a.mostrar : []).map(String).slice(0, 20) };
      await db.from('crm_google').update({ agendas }).eq('id', 1);
      return json({ ok: true, agendas });
    }
    case 'criar_agenda': {
      const r = await fetch(`${CALS}/calendars`, { method: 'POST', headers: auth, body: JSON.stringify({ summary: String(b.nome || 'Pessoal').slice(0, 60), timeZone: 'America/Sao_Paulo' }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return json({ erro: erroGoogle(j) }, 502);
      return json({ id: j.id });
    }

    case 'contatos': { // Contatos do Google (People API), para importar como clientes
      const todos: unknown[] = []; let pagina = '';
      do {
        const p = new URLSearchParams({ personFields: 'names,emailAddresses,phoneNumbers,organizations', pageSize: '1000' }); if (pagina) p.set('pageToken', pagina);
        const r = await fetch('https://people.googleapis.com/v1/people/me/connections?' + p, { headers: auth }); const j = await r.json().catch(() => ({}));
        if (!r.ok) return json({ erro: erroGoogle(j) }, 502);
        for (const c of j.connections ?? []) {
          const x = { nome: c.names?.[0]?.displayName || '', email: c.emailAddresses?.[0]?.value || '', telefone: c.phoneNumbers?.[0]?.value || '', empresa: c.organizations?.[0]?.name || '' };
          if (x.nome || x.email) todos.push(x);
        }
        pagina = j.nextPageToken || '';
      } while (pagina && todos.length < 5000);
      return json({ contatos: todos });
    }

    case 'email': { // sai do Gmail da conta conectada
      const para = String(b.para || '').trim();
      if (!/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(para)) return json({ erro: 'E-mail do destinatário inválido.' }, 400);
      const anexos = Array.isArray(b.anexos) ? b.anexos.slice(0, 10) : [];
      const mime = montarEmail(para, String(b.assunto || '').replace(/[\r\n]+/g, ' ').slice(0, 300), String(b.texto || ''), anexos);
      const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', { method: 'POST', headers: { Authorization: 'Bearer ' + t.token, 'Content-Type': 'message/rfc822' }, body: mime });
      return r.ok ? json({ ok: true }) : json({ erro: erroGoogle(await r.json().catch(() => ({}))) }, 502);
    }
  }
  return json({ erro: 'Ação desconhecida' }, 400);
});
