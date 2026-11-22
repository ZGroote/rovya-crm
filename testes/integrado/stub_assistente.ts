// SÓ PARA O TESTE INTEGRADO: o workflow copia este arquivo por cima da crm-assistente antes de subir as funções.
// A crm-assistente de verdade manda notificação ao celular e chama o Gemini; aqui ela só grava o aviso em
// public.teste_avisos, para o teste conferir se o aviso sairia (e uma vez só), sem mandar nada de verdade.
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  const { data: k } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
  if (!k?.valor || req.headers.get('x-cron') !== k.valor) return json({ erro: 'Sem permissão (assistente de teste)' }, 401);
  if (b.aviso) await db.from('teste_avisos').insert({ titulo: b.aviso.titulo, corpo: b.aviso.corpo, url: b.aviso.url });
  return json({ ok: true });
});
