// Assistente da Sabrina: resumo do dia, chat com IA (Gemini, nível pago) e notificações no celular.
// POST com login de admin:
//   {acao:'chat', mensagens:[{role,content}]}  conversa (sem mensagens = resumo do dia escrito pela IA)
//   {acao:'chave'}                              chave pública para inscrever o celular nas notificações
//   {acao:'testar'}                             manda uma notificação de teste
// POST do pg_cron com header x-cron = crm_config.cron_key: notificação "seu resumo de hoje".
// Secrets: GEMINI_API_KEY (chave de um projeto com faturamento = nível pago), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@^0.5.0';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const TZ = 'America/Sao_Paulo';
const APP = 'https://zgroote.github.io/rovya-crm/app.html';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const hojeSP = () => new Date().toLocaleDateString('sv', { timeZone: TZ });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------- dados ---------- */
async function agenda(dias: number) {
  const { data } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: data.refresh_token, grant_type: 'refresh_token' }) })).json();
  if (!t.access_token) return null;
  const de = new Date(`${hojeSP()}T00:00:00-03:00`), ate = new Date(de.getTime() + dias * 864e5);
  const r = await (await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
    timeMin: de.toISOString(), timeMax: ate.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }),
    { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
  return (r.items ?? []).map((e: any) => ({
    quando: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : `${e.start?.date} (dia todo)`,
    titulo: e.summary || '(sem título)', local: e.location || undefined, dia: (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString('sv', { timeZone: TZ }) : e.start?.date) }));
}

async function retrato() {
  const [cli, ops, projs, parc, ag] = await Promise.all([
    db.from('crm_clientes').select('id,nome,empresa,origem,criado_em').order('nome'),
    db.from('crm_oportunidades').select('titulo,etapa,valor,proximo_passo,proximo_em,motivo_perda,atualizado_em,crm_clientes(nome,empresa)'),
    db.from('crm_projetos').select('nome,status,valor,entrega_prevista,inicio,crm_clientes(nome,empresa),crm_etapas(ordem,titulo,crm_entregas(ordem,titulo,status,prazo))'),
    db.from('crm_parcelas').select('descricao,valor,vencimento,pago_em,forma,crm_projetos(nome)').order('vencimento'),
    agenda(14),
  ]);
  const quem = (c: any) => c ? (c.empresa ? `${c.empresa} (${c.nome})` : c.nome) : '';
  return {
    hoje: new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    hoje_iso: hojeSP(),
    clientes: (cli.data ?? []).map(c => ({ nome: c.nome, empresa: c.empresa, origem: c.origem, desde: c.criado_em?.slice(0, 10) })),
    funil: (ops.data ?? []).map((o: any) => ({ cliente: quem(o.crm_clientes), oportunidade: o.titulo, etapa: o.etapa, valor: o.valor, proximo_passo: o.proximo_passo, proximo_em: o.proximo_em, motivo_perda: o.motivo_perda, atualizado: o.atualizado_em?.slice(0, 10) })),
    projetos: (projs.data ?? []).map((p: any) => ({ nome: p.nome, cliente: quem(p.crm_clientes), status: p.status, valor: p.valor, inicio: p.inicio, entrega_prevista: p.entrega_prevista,
      etapas: (p.crm_etapas ?? []).sort((a: any, b: any) => a.ordem - b.ordem).map((e: any) => ({ etapa: e.titulo,
        entregas: (e.crm_entregas ?? []).sort((a: any, b: any) => a.ordem - b.ordem).map((x: any) => `${x.titulo} [${x.status}${x.prazo ? ', prazo ' + x.prazo : ''}]`) })) })),
    parcelas: (parc.data ?? []).map((x: any) => ({ projeto: x.crm_projetos?.nome, descricao: x.descricao, valor: x.valor, vencimento: x.vencimento, pago_em: x.pago_em, forma: x.forma })),
    agenda_14_dias: ag ?? 'Google Agenda não conectado',
  };
}

// resumo curto, sem IA, para a notificação
function resumoCurto(r: any) {
  const h = r.hoje_iso, partes: string[] = [];
  const ev = Array.isArray(r.agenda_14_dias) ? r.agenda_14_dias.filter((e: any) => e.dia === h).length : 0;
  if (ev) partes.push(`📅 ${ev} compromisso${ev > 1 ? 's' : ''}`);
  const ent = r.projetos.filter((p: any) => p.status === 'ativo').flatMap((p: any) => p.etapas.flatMap((e: any) => e.entregas))
    .filter((t: string) => !t.includes('[aprovado') && (t.match(/prazo (\d{4}-\d{2}-\d{2})/)?.[1] ?? '9999') <= h).length;
  if (ent) partes.push(`✅ ${ent} entrega${ent > 1 ? 's' : ''} no prazo`);
  const din = r.parcelas.filter((x: any) => !x.pago_em && x.vencimento && x.vencimento <= h).reduce((s: number, x: any) => s + +x.valor, 0);
  if (din) partes.push(`💰 ${brl(din)} a receber`);
  const pend = r.funil.filter((o: any) => !['ganho', 'perdido'].includes(o.etapa) && o.proximo_em && o.proximo_em <= h).length;
  if (pend) partes.push(`⚠️ ${pend} próximo${pend > 1 ? 's' : ''} passo${pend > 1 ? 's' : ''}`);
  return partes.length ? partes.join(' • ') : 'Dia tranquilo por aqui ✨ Toque para ver seu resumo.';
}

/* ---------- IA ---------- */
const SISTEMA = `Você é a assistente pessoal da Sabrina, dona da Rovya Creative (consultoria de posicionamento e gestão estratégica da comunicação).
Você conversa com ela dentro do CRM da Rovya, como num chat de celular: português do Brasil, tom próximo e elegante, respostas curtas e diretas, com poucos emojis e listas curtas quando ajudar.
Responda só com base nos DADOS DO CRM abaixo. Se algo não estiver nos dados, diga que não encontrou no CRM em vez de inventar. Valores em reais (R$), datas no formato brasileiro.
Você ainda não consegue alterar nada no CRM; se ela pedir para mudar algo, explique onde fazer isso no CRM (Funil, Clientes, Projetos, Agenda, Financeiro ou Modelos).
Status das entregas: a_fazer, produzindo, enviado, revisao, aprovado. Etapas do funil: contato, diagnostico, proposta, negociacao, ganho, perdido.
Quando ela pedir o resumo do dia, organize em: agenda de hoje, entregas com prazo hoje ou atrasadas, dinheiro a receber hoje ou atrasado, próximos passos do funil vencendo, e termine com uma sugestão prática de prioridade. Se o dia estiver vazio, diga isso com leveza.`;

const MODELO = 'gemini-3.8-flash';

async function conversar(mensagens: { role: 'user' | 'assistant'; content: string }[]) {
  const dados = await retrato();
  const msgs = mensagens.length ? mensagens : [{ role: 'user' as const, content: 'Bom dia! Me dá o resumo de hoje?' }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SISTEMA + '

DADOS DO CRM (atualizados agora):
' + JSON.stringify(dados) }] },
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  const j = await r.json();
  if (!r.ok) { console.error('gemini', r.status, j.error?.message); throw new Error(`IA indisponível (${r.status}). Tente de novo em instantes.`); }
  if (j.promptFeedback?.blockReason) return 'Desculpe, não consegui responder isso. Pode perguntar de outro jeito?';
  const texto = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('').trim();
  return texto || 'Não consegui montar uma resposta agora.';
}

/* ---------- notificações ---------- */
async function servidorPush() {
  const { data } = await db.from('crm_config').select('valor').eq('chave', 'vapid').maybeSingle();
  let chaves;
  if (data?.valor) chaves = await webpush.importVapidKeys(JSON.parse(data.valor), { extractable: false });
  else { // primeira vez: gera e guarda no banco (a privada nunca sai do servidor)
    const novas = await webpush.generateVapidKeys({ extractable: true });
    await db.from('crm_config').insert({ chave: 'vapid', valor: JSON.stringify(await webpush.exportVapidKeys(novas)) });
    chaves = novas;
  }
  const app = await webpush.ApplicationServer.new({ contactInformation: 'mailto:rovyacreative@gmail.com', vapidKeys: chaves });
  return { app, publica: await webpush.exportApplicationServerKey(chaves) };
}

async function notificar(titulo: string, corpo: string) {
  const { app } = await servidorPush();
  const { data: subs } = await db.from('crm_push').select('endpoint,inscricao');
  let ok = 0, removidas = 0;
  for (const s of subs ?? []) {
    try {
      await app.subscribe(s.inscricao).pushTextMessage(JSON.stringify({ title: titulo, body: corpo, url: APP + '#/assistente' }), {});
      ok++;
    } catch (e) {
      const st = (e as any)?.response?.status;
      if (st === 404 || st === 410 || (e as any)?.isGone?.()) { await db.from('crm_push').delete().eq('endpoint', s.endpoint); removidas++; }
      else console.error('push falhou', st, (e as Error).message);
    }
  }
  return { enviadas: ok, removidas, total: subs?.length ?? 0 };
}

async function eAdmin(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!t) return false;
  const { data: { user } } = await db.auth.getUser(t);
  if (!user?.email) return false;
  return !!(await db.from('admins').select('email').eq('email', user.email).maybeSingle()).data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const cron = req.headers.get('x-cron');
    if (cron) {
      const { data } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
      if (!data?.valor || cron !== data.valor) return json({ erro: 'Sem permissão' }, 401);
      return json(await notificar('Bom dia, Sabrina! ☀️', resumoCurto(await retrato())));
    }
    if (!await eAdmin(req)) return json({ erro: 'Sem permissão' }, 401);
    const b = await req.json().catch(() => ({}));
    switch (b.acao) {
      case 'chave': return json({ publica: (await servidorPush()).publica });
      case 'testar': return json(await notificar('Rovya ✦', 'As notificações estão funcionando neste aparelho.'));
      case 'chat': {
        if (!env('GEMINI_API_KEY')) return json({ erro: 'Assistente ainda não configurado (falta GEMINI_API_KEY nos secrets).' }, 503);
        const msgs = (Array.isArray(b.mensagens) ? b.mensagens : []).slice(-20)
          .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
        if (msgs.length && msgs[0].role !== 'user') msgs.shift(); // a conversa precisa começar pela Sabrina
        return json({ resposta: await conversar(msgs) });
      }
    }
    return json({ erro: 'Ação desconhecida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});
