// Resumo diário da Sabrina por WhatsApp (API oficial da Meta, modelo "resumo_diario").
// Disparo: pg_cron -> POST com header x-cron = crm_config.cron_key   (envia)
// Pelo CRM (login de admin): {acao:'previa'} devolve o texto; {acao:'enviar'} manda agora.
// Secrets: WA_TOKEN, WA_PHONE_ID, WA_DESTINOS (números com DDI, separados por vírgula), GOOGLE_CLIENT_ID/SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const TZ = 'America/Sao_Paulo';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

const hojeSP = () => new Date().toLocaleDateString('sv', { timeZone: TZ });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diasAtras = (d: string) => Math.round((Date.parse(hojeSP()) - Date.parse(d)) / 864e5);
const quando = (d: string) => { const n = diasAtras(d); return n <= 0 ? 'hoje' : n === 1 ? 'atrasado 1 dia' : `atrasado ${n} dias`; };
// parâmetros de modelo do WhatsApp não aceitam quebra de linha nem 4+ espaços seguidos
const linha = (itens: string[], vazio: string) => (itens.length ? itens.join(' • ') : vazio).replace(/\s+/g, ' ').slice(0, 600);

async function agendaHoje(): Promise<string[] | null> {
  const { data } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: data.refresh_token, grant_type: 'refresh_token' }) })).json();
  if (!t.access_token) return null;
  const h = hojeSP(), de = new Date(`${h}T00:00:00-03:00`), ate = new Date(`${h}T23:59:59-03:00`);
  const r = await (await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
    timeMin: de.toISOString(), timeMax: ate.toISOString(), singleEvents: 'true', orderBy: 'startTime' }), { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
  return (r.items ?? []).map((e: any) => (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) + ' ' : '') + (e.summary || 'compromisso'));
}

export async function montar() {
  const h = hojeSP();
  const [ents, parc, ops, agenda] = await Promise.all([
    db.from('crm_entregas').select('titulo,prazo,crm_etapas!inner(crm_projetos!inner(nome,status,crm_clientes(nome,empresa)))')
      .neq('status', 'aprovado').eq('crm_etapas.crm_projetos.status', 'ativo').lte('prazo', h).order('prazo'),
    db.from('crm_parcelas').select('valor,vencimento,descricao,crm_projetos(nome,crm_clientes(nome,empresa))').is('pago_em', null).lte('vencimento', h).order('vencimento'),
    db.from('crm_oportunidades').select('proximo_passo,titulo,proximo_em,crm_clientes(nome,empresa)').not('etapa', 'in', '(ganho,perdido)').lte('proximo_em', h).order('proximo_em'),
    agendaHoje(),
  ]);
  const cli = (c: any) => c?.empresa || c?.nome || '';
  const p = [
    'Sabrina',
    agenda === null ? 'agenda do Google não conectada' : linha(agenda, 'dia livre na agenda ✨'),
    linha((ents.data ?? []).map((e: any) => `${e.titulo} (${cli(e.crm_etapas.crm_projetos.crm_clientes)}, ${quando(e.prazo)})`), 'nenhuma vencendo'),
    linha((parc.data ?? []).map((x: any) => `${brl(+x.valor)} de ${cli(x.crm_projetos?.crm_clientes)} (${quando(x.vencimento)})`), 'nada a receber hoje'),
    linha((ops.data ?? []).map((o: any) => `${o.proximo_passo || o.titulo} (${cli(o.crm_clientes)}, ${quando(o.proximo_em)})`), 'tudo em dia'),
  ];
  const texto = `Bom dia, ${p[0]}! ☀️\n\n📅 Agenda: ${p[1]}\n✅ Entregas: ${p[2]}\n💰 Financeiro: ${p[3]}\n⚠️ Pendências: ${p[4]}\n\nBom trabalho! 🌹`;
  return { parametros: p, texto };
}

async function enviar(parametros: string[]) {
  const destinos = env('WA_DESTINOS').split(',').map(s => s.replace(/\D/g, '')).filter(Boolean);
  if (!env('WA_TOKEN') || !env('WA_PHONE_ID') || !destinos.length) throw new Error('WhatsApp ainda não configurado (WA_TOKEN, WA_PHONE_ID, WA_DESTINOS).');
  const out = [];
  for (const to of destinos) {
    const r = await fetch(`https://graph.facebook.com/v21.0/${env('WA_PHONE_ID')}/messages`, { method: 'POST',
      headers: { Authorization: 'Bearer ' + env('WA_TOKEN'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ messaging_product: 'whatsapp', to, type: 'template', template: { name: 'resumo_diario', language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters: parametros.map(text => ({ type: 'text', text })) }] } }) });
    const j = await r.json();
    out.push({ to: to.slice(0, 4) + '…' + to.slice(-2), ok: r.ok, erro: j.error?.message });
  }
  return out;
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
      const { parametros } = await montar();
      return json({ enviados: await enviar(parametros) });
    }
    if (!await eAdmin(req)) return json({ erro: 'Sem permissão' }, 401);
    const b = await req.json().catch(() => ({}));
    const r = await montar();
    if (b.acao === 'enviar') return json({ ...r, enviados: await enviar(r.parametros) });
    return json(r);
  } catch (e) { return json({ erro: (e as Error).message }, 500); }
});
