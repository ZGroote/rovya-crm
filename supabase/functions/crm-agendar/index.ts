// Agenda pública da Rovya (rovyacreative.com.br/agendar), sem login.
// POST {acao:'horarios'} → horários livres: os períodos que a Sabrina reservou no CRM ("Reservado · novos clientes",
//   evento do Google com crm_reserva=1), divididos em atendimentos de crm_slot minutos, menos o que já está ocupado
//   nas agendas profissional e pessoal. Nunca devolve o que há na agenda dela, só os horários livres.
// POST {acao:'reservar', inicio, nome, email, telefone, empresa, mensagem} → confere de novo, grava em crm_agendamentos
//   (índice único: ninguém pega o mesmo horário), cadastra/acha o cliente, cria a reunião com Google Meet e convite
//   para a pessoa, e avisa a Sabrina no celular.
// POST {acao:'contato', nome, contato (WhatsApp ou e-mail), mensagem, pagina} → assistente do site (site/assistente.js):
//   acha/cadastra o cliente (origem "Chat do site"), registra a mensagem no histórico e avisa a Sabrina. Não depende do Google.
// Deploy com verify_jwt = false.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const CID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '', CSEC = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const evUrl = (cal: string) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal)}/events`;
// ponytail: regras fixas no código; viram configuração no CRM se a Sabrina quiser mudar com frequência
const ANTECEDENCIA_H = 12, DIAS = 45, POR_IP_DIA = 3, FUTUROS_POR_EMAIL = 2;
const ORIGENS = ['https://rovyacreative.com.br', 'https://www.rovyacreative.com.br'];

const cors = (req: Request) => {
  const o = req.headers.get('Origin') || '';
  return { 'Access-Control-Allow-Origin': ORIGENS.includes(o) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(o) ? o : ORIGENS[0],
    'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
};

async function google() {
  const { data } = await db.from('crm_google').select('refresh_token,agendas').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: CID, client_secret: CSEC, refresh_token: data.refresh_token, grant_type: 'refresh_token' }) });
  const j = await r.json();
  if (!r.ok) return null;
  const a = data.agendas ?? {};
  return { token: j.access_token as string, profissional: (a.profissional || 'primary') as string, pessoal: (a.pessoal || null) as string | null };
}

type Ev = { id: string, status?: string, transparency?: string, start: { dateTime?: string, date?: string }, end: { dateTime?: string, date?: string },
  extendedProperties?: { private?: Record<string, string> }, attendees?: { self?: boolean, responseStatus?: string }[] };
const ms = (x: { dateTime?: string, date?: string }) => new Date(x.dateTime || x.date + 'T00:00:00-03:00').getTime(); // dia inteiro: Brasília

async function livres(g: NonNullable<Awaited<ReturnType<typeof google>>>) {
  const agora = Date.now(), de = agora + ANTECEDENCIA_H * 36e5, ate = agora + DIAS * 864e5;
  const p = new URLSearchParams({ timeMin: new Date(de).toISOString(), timeMax: new Date(ate).toISOString(), singleEvents: 'true', maxResults: '2500' });
  const cals = [g.profissional, ...(g.pessoal ? [g.pessoal] : [])];
  const evs: Ev[] = (await Promise.all(cals.map(async c => {
    const r = await fetch(evUrl(c) + '?' + p, { headers: { Authorization: 'Bearer ' + g.token } });
    return r.ok ? ((await r.json()).items ?? []) : [];
  }))).flat().filter((e: Ev) => e.status !== 'cancelled');
  const reservas = evs.filter(e => e.extendedProperties?.private?.crm_reserva === '1');
  const ocupado = evs.filter(e => e.extendedProperties?.private?.crm_reserva !== '1' && e.transparency !== 'transparent'
    && !e.attendees?.some(a => a.self && a.responseStatus === 'declined')).map(e => [ms(e.start), ms(e.end)]);
  const slots = new Map<number, number>();
  for (const r of reservas) {
    const dur = Math.max(15, Number(r.extendedProperties?.private?.crm_slot) || 60) * 6e4;
    for (let s = ms(r.start); s + dur <= ms(r.end); s += dur)
      if (s >= de && !ocupado.some(([a, b]) => s < b && s + dur > a)) slots.set(s, s + dur);
  }
  return [...slots].sort((a, b) => a[0] - b[0]).map(([s, f]) => ({ inicio: new Date(s).toISOString(), fim: new Date(f).toISOString() }));
}

// aviso no celular da Sabrina (pela função do assistente, que guarda as inscrições de notificação)
async function avisar(titulo: string, corpo: string, url: string) {
  const { data: k } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
  if (k?.valor) await fetch(`${SUPA}/functions/v1/crm-assistente`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron': k.valor },
    body: JSON.stringify({ aviso: { titulo, corpo, url } }) }).catch(() => { });
}
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const semCuringa = (s: string) => s.replace(/[%_\\]/g, '\\$&'); // e-mail no ilike: _ e % são literais
const CHAT_POR_DIA = 40;

async function contato(b: Record<string, unknown>): Promise<[unknown, number]> {
  if (b.site) return [{ ok: true }, 200]; // campo escondido preenchido: robô
  const nome = txt(b.nome, 120), contato = txt(b.contato, 160), mensagem = txt(b.mensagem, 1500), pagina = txt(b.pagina, 60);
  if (nome.length < 2) return [{ erro: 'Como posso te chamar?' }, 400];
  const email = EMAIL.test(contato) ? contato.toLowerCase() : null;
  if (!email && contato.replace(/\D/g, '').length < 10) return [{ erro: 'Deixe um WhatsApp com DDD ou um e-mail.' }, 400];
  const { count } = await db.from('crm_interacoes').select('id', { count: 'exact', head: true }).like('resumo', 'Pelo chat do site%').gte('criado_em', new Date(Date.now() - 864e5).toISOString());
  if ((count ?? 0) >= CHAT_POR_DIA) return [{ erro: 'Muitos contatos por aqui hoje.' }, 429];
  let cli = email ? (await db.from('crm_clientes').select('id').ilike('email', semCuringa(email)).limit(1).maybeSingle()).data : null;
  if (!cli) cli = (await db.from('crm_clientes').insert({ nome, email, telefone: email ? null : contato, origem: 'Chat do site' }).select('id').single()).data;
  if (!cli) return [{ erro: 'Não consegui enviar agora.' }, 500];
  await db.from('crm_interacoes').insert({ cliente_id: cli.id, tipo: 'mensagem',
    resumo: `Pelo chat do site${pagina ? ` (${pagina})` : ''}: pediu retorno por ${email ? 'e-mail' : 'WhatsApp'} (${contato}).${mensagem ? `\n\n${mensagem}` : ''}` });
  await avisar('Novo contato pelo site ✦', `${nome} · ${contato}${mensagem ? ` · “${mensagem.slice(0, 80)}”` : ''}`, `app.html#/cliente/${cli.id}`);
  return [{ ok: true }, 200];
}

const quandoBR = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });

Deno.serve(async req => {
  const h = cors(req), json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...h, 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response('ok', { headers: h });
  if (req.method !== 'POST') return json({ erro: 'Use POST' }, 405);
  try {
    const b = await req.json().catch(() => ({}));
    if (b.acao === 'contato') { const [o, s] = await contato(b); return json(o, s); }
    const g = await google();
    if (!g) return json({ horarios: [], fechado: true });
    if (b.acao === 'horarios') return json({ horarios: await livres(g) });
    if (b.acao !== 'reservar') return json({ erro: 'Ação desconhecida' }, 400);

    // ---- reservar ----
    if (b.site) return json({ ok: true }); // campo escondido preenchido: robô
    const nome = txt(b.nome, 120), email = txt(b.email, 160).toLowerCase(), telefone = txt(b.telefone, 40), empresa = txt(b.empresa, 120), mensagem = txt(b.mensagem, 2000);
    if (nome.length < 2) return json({ erro: 'Escreva seu nome.' }, 400);
    if (!EMAIL.test(email)) return json({ erro: 'Confira o e-mail: é por ele que chega o convite.' }, 400);
    const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || null;
    if (ip) {
      const { count } = await db.from('crm_agendamentos').select('id', { count: 'exact', head: true }).eq('ip', ip).gte('criado_em', new Date(Date.now() - 864e5).toISOString());
      if ((count ?? 0) >= POR_IP_DIA) return json({ erro: 'Muitos agendamentos seguidos daqui. Se precisar, fale pelo Instagram @rovyacreative.' }, 429);
    }
    const { count: futuros } = await db.from('crm_agendamentos').select('id', { count: 'exact', head: true }).eq('email', email).eq('status', 'confirmado').gte('inicio', new Date().toISOString());
    if ((futuros ?? 0) >= FUTUROS_POR_EMAIL) return json({ erro: 'Você já tem conversas marcadas. Se precisar mudar, responda o convite que chegou no seu e-mail.' }, 409);

    const slot = (await livres(g)).find(s => s.inicio === b.inicio);
    if (!slot) return json({ erro: 'Esse horário acabou de ficar indisponível. Escolha outro, por favor.' }, 409);

    // trava o horário: o índice único só deixa um agendamento confirmado por início
    const reg = { inicio: slot.inicio, fim: slot.fim, nome, email, telefone: telefone || null, empresa: empresa || null, mensagem: mensagem || null, ip };
    let { data: ag, error } = await db.from('crm_agendamentos').insert(reg).select('id').single();
    if (error?.code === '23505') { // o anterior foi apagado da agenda pela Sabrina? então libera e tenta de novo
      const { data: velho } = await db.from('crm_agendamentos').select('id,evento_id').eq('inicio', slot.inicio).eq('status', 'confirmado').maybeSingle();
      const ev = velho?.evento_id ? await fetch(evUrl(g.profissional) + '/' + encodeURIComponent(velho.evento_id), { headers: { Authorization: 'Bearer ' + g.token } }) : null;
      const sumiu = !velho?.evento_id || !ev?.ok || (await ev.json()).status === 'cancelled';
      if (!sumiu) return json({ erro: 'Esse horário acabou de ser preenchido. Escolha outro, por favor.' }, 409);
      await db.from('crm_agendamentos').update({ status: 'cancelado' }).eq('id', velho!.id);
      ({ data: ag, error } = await db.from('crm_agendamentos').insert(reg).select('id').single());
    }
    if (error || !ag) return json({ erro: 'Não consegui confirmar agora. Tente de novo em instantes.' }, 500);

    // cliente: acha pelo e-mail ou cadastra como novo contato vindo da agenda do site
    let { data: cli } = await db.from('crm_clientes').select('id').ilike('email', semCuringa(email)).limit(1).maybeSingle();
    if (!cli) ({ data: cli } = await db.from('crm_clientes').insert({ nome, empresa: empresa || null, email, telefone: telefone || null, origem: 'Agenda do site' }).select('id').single());
    const quando = quandoBR(slot.inicio);

    const r = await fetch(evUrl(g.profissional) + '?conferenceDataVersion=1&sendUpdates=all', { method: 'POST',
      headers: { Authorization: 'Bearer ' + g.token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        summary: `Primeira conversa · ${nome}${empresa ? ` (${empresa})` : ''}`,
        description: [`Agendado pelo site rovyacreative.com.br/agendar.`, `E-mail: ${email}`, telefone && `WhatsApp: ${telefone}`, empresa && `Marca/empresa: ${empresa}`, mensagem && `\nO que busca:\n${mensagem}`].filter(Boolean).join('\n'),
        start: { dateTime: slot.inicio }, end: { dateTime: slot.fim },
        attendees: [{ email, displayName: nome }],
        conferenceData: { createRequest: { requestId: ag.id, conferenceSolutionKey: { type: 'hangoutsMeet' } } },
        extendedProperties: { private: { crm_cliente: cli?.id ?? '', crm_agendamento: ag.id } },
      }) });
    const ev = await r.json().catch(() => ({}));
    if (!r.ok) {
      await db.from('crm_agendamentos').delete().eq('id', ag.id); // libera o horário
      await db.from('crm_falhas').insert({ origem: 'agenda', acao: 'agendamento do site', mensagem: `${nome} (${email}) tentou marcar ${quando}, mas o Google recusou: ${ev.error?.message || r.status}` });
      return json({ erro: 'Não consegui confirmar agora. Tente de novo em instantes ou fale pelo Instagram @rovyacreative.' }, 502);
    }
    await db.from('crm_agendamentos').update({ evento_id: ev.id, cliente_id: cli?.id ?? null }).eq('id', ag.id);
    if (cli?.id) {
      await db.from('crm_interacoes').insert({ cliente_id: cli.id, tipo: 'nota', resumo: `Agendou pelo site: primeira conversa em ${quando}.${mensagem ? `\n\nO que busca: ${mensagem}` : ''}` });
      const { data: aberta } = await db.from('crm_oportunidades').select('id').eq('cliente_id', cli.id).not('etapa', 'in', '(ganho,perdido)').limit(1).maybeSingle();
      if (!aberta) await db.from('crm_oportunidades').insert({ cliente_id: cli.id, titulo: 'Primeira conversa (agenda do site)', etapa: 'contato', proximo_passo: 'Primeira conversa', proximo_em: slot.inicio.slice(0, 10) });
    }
    await avisar('Novo agendamento pelo site ✦', `${nome}${empresa ? ` (${empresa})` : ''} · ${quando}`, 'app.html#/agenda');

    return json({ ok: true, inicio: slot.inicio, fim: slot.fim, quando, meet: ev.hangoutLink ?? null });
  } catch (e) {
    console.error(e);
    return json({ erro: 'Não consegui confirmar agora. Tente de novo em instantes.' }, 500);
  }
});
