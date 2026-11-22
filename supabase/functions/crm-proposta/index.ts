// Proposta aceita online (rovyacreative.com.br/proposta#<link>). Sem login: quem tem o link vê a proposta e pode aceitar.
// O link (crm_propostas.token, 32 letras aleatórias) nasce quando a Sabrina marca a proposta como enviada e só vale para a
// última versão, dentro da validade. Aceitar grava nome, data e IP (prova do aceite), aprova a proposta, fecha o cartão do funil
// e registra no histórico, numa transação só (crm_proposta_aceitar). Contrato e projeto a Sabrina cria pelo Início ("Próximos passos").
// {acao:'ver', token} | {acao:'aceitar', token, nome}. Deploy com verify_jwt = false.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const TOKEN = /^[0-9a-f]{32}$/;

async function avisar(titulo: string, corpo: string, url: string) {
  const { data: k } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
  if (k?.valor) await fetch(`${SUPA}/functions/v1/crm-assistente`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron': k.valor },
    body: JSON.stringify({ aviso: { titulo, corpo, url } }) }).catch(() => { });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  try {
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    const token = String(b.token ?? '');
    if (!TOKEN.test(token)) return json({ erro: 'Link inválido. Confira com a Rovya.' }, 404);
    if (b.acao === 'ver') {
      const { data, error } = await db.rpc('crm_proposta_publica', { p_token: token });
      if (error) throw error;
      return data ? json(data) : json({ erro: 'Link inválido. Confira com a Rovya.' }, 404);
    }
    if (b.acao === 'aceitar') {
      const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
      const { data: r, error } = await db.rpc('crm_proposta_aceitar', { p_token: token, p_nome: String(b.nome ?? '').slice(0, 200), p_ip: ip });
      if (error) throw error;
      if (r?.erro) return json({ erro: r.erro }, r.codigo ?? 400);
      if (!r.ja) await avisar('Proposta aceita ✦', `${r.empresa}: “${r.titulo}”, por ${r.aceite_nome}`, `app.html#/proposta/${r.id}`);
      return json({ ok: true, aceite_em: r.aceite_em, aceite_nome: r.aceite_nome });
    }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: 'Falha ao abrir a proposta. Tente de novo em instantes.' }, 500);
  }
});
