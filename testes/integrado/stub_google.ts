// SÓ PARA O TESTE INTEGRADO: o workflow copia este arquivo por cima da crm-google antes de subir as funções.
// Sem Google de verdade: o e-mail vai para a tabela public.teste_emails (nada sai), e o resto responde "não conectado".
import { createClient } from 'jsr:@supabase/supabase-js@2';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const { data } = await db.auth.getUser(t);
  if (!data?.user) return json({ erro: 'Sem permissão (Google de teste)' }, 401);
  const b = await req.json().catch(() => ({})) as Record<string, any>;
  if (b.acao === 'email') {
    await db.from('teste_emails').insert({ para: b.para, assunto: b.assunto, texto: b.texto });
    return json({ ok: true });
  }
  return json({ conectado: false });
});
