// Importação do Trello (só admin do CRM). A chave e o token do Trello ficam em crm_config 'trello' (tabela sem política:
// o navegador não lê; só esta função). O CRM monta o projeto com a estrutura; os arquivos vêm um a um por 'anexo'.
// {acao:'config'} → {configurado, nome}
// {acao:'salvar', key, token} → confere no Trello e guarda
// {acao:'quadro', link} → listas e cartões abertos do quadro, com anexos e checklists
// {acao:'anexo', card, anexo, caminho} → baixa o arquivo do Trello e grava no bucket crm-anexos (caminho dentro do projeto)
// Deploy com verify_jwt = false (o login é conferido aqui, como no crm-google).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const API = 'https://api.trello.com/1';
const ID = /^[0-9a-f]{24}$/, CURTO = /^[A-Za-z0-9]{8}$/;
const LIMITE = 50 * 1048576; // o mesmo limite dos anexos do CRM

async function eAdmin(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!t || t.split('.').length !== 3) return false;
  const { data: { user } } = await db.auth.getUser(t);
  if (!user?.email) return false;
  const aal = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
  if (user.factors?.some((f: any) => f.status === 'verified') && aal !== 'aal2') return false;
  const { data } = await db.from('admins').select('email').eq('email', user.email).maybeSingle();
  return !!data;
}
async function credenciais() {
  const { data } = await db.from('crm_config').select('valor').eq('chave', 'trello').maybeSingle();
  return data?.valor ? JSON.parse(data.valor) as { key: string, token: string, nome?: string } : null;
}
const auth = (c: { key: string, token: string }) => ({ Authorization: `OAuth oauth_consumer_key="${c.key}", oauth_token="${c.token}"` });
async function trello(c: { key: string, token: string }, caminho: string) {
  const r = await fetch(API + caminho, { headers: auth(c) });
  if (!r.ok) throw new Error(r.status === 401 ? 'O Trello recusou a chave ou o token. Gere de novo e salve.' : r.status === 404 ? 'Quadro não encontrado (confira o link e se a conta do token vê esse quadro).' : 'Trello: ' + r.status);
  return r.json();
}

async function quadro(c: { key: string, token: string }, link: string) {
  const id = String(link).match(/trello\.com\/b\/([A-Za-z0-9]{8})/)?.[1] ?? (CURTO.test(link) ? link : null);
  if (!id) return json({ erro: 'Cole o link do quadro (trello.com/b/…).' }, 400);
  const b = await trello(c, `/boards/${id}?fields=name&lists=open&list_fields=name,pos&cards=open&card_fields=name,desc,due,dueComplete,idList,pos&card_attachments=true&card_attachment_fields=name,bytes,mimeType,isUpload,url&card_checklists=all`);
  const cartoes = (b.cards ?? []).sort((x: any, y: any) => x.pos - y.pos);
  return json({
    nome: b.name,
    listas: (b.lists ?? []).sort((x: any, y: any) => x.pos - y.pos).map((l: any) => ({
      id: l.id, nome: l.name,
      cartoes: cartoes.filter((k: any) => k.idList === l.id).map((k: any) => ({
        id: k.id, nome: k.name, desc: k.desc || '', due: k.due, feito: !!k.dueComplete,
        anexos: (k.attachments ?? []).map((a: any) => ({ id: a.id, nome: a.name, bytes: a.bytes, tipo: a.mimeType, upload: !!a.isUpload, url: a.url })),
        checklists: (k.checklists ?? []).map((ch: any) => ({ nome: ch.name, itens: (ch.checkItems ?? []).sort((x: any, y: any) => x.pos - y.pos).map((i: any) => ({ nome: i.name, feito: i.state === 'complete' })) })),
      })),
    })),
  });
}

async function anexo(c: { key: string, token: string }, b: Record<string, unknown>) {
  const card = String(b.card), id = String(b.anexo), caminho = String(b.caminho ?? '');
  if (!ID.test(card) || !ID.test(id)) return json({ erro: 'Anexo inválido.' }, 400);
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[^/]+$/.test(caminho)) return json({ erro: 'Caminho inválido.' }, 400); // projeto/entrega/arquivo
  const info = await trello(c, `/cards/${card}/attachments/${id}?fields=name,bytes,mimeType,isUpload`);
  if (!info.isUpload) return json({ erro: 'Esse anexo é um link, não um arquivo.' }, 400);
  if (info.bytes > LIMITE) return json({ erro: `“${info.name}” passa de 50 MB.` }, 413);
  const r = await fetch(`${API}/cards/${card}/attachments/${id}/download/${encodeURIComponent(info.name)}`, { headers: auth(c) });
  if (!r.ok) return json({ erro: 'Não consegui baixar do Trello: ' + r.status }, 502);
  const corpo = new Uint8Array(await r.arrayBuffer());
  const { error } = await db.storage.from('crm-anexos').upload(caminho, corpo, { contentType: info.mimeType || r.headers.get('content-type') || 'application/octet-stream', upsert: true });
  if (error) return json({ erro: 'Não consegui guardar o arquivo: ' + error.message }, 500);
  return json({ ok: true, tamanho: corpo.byteLength });
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    if (!await eAdmin(req)) return json({ erro: 'Sem permissão.' }, 403);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (b.acao === 'salvar') {
      const c = { key: String(b.key ?? '').trim(), token: String(b.token ?? '').trim() };
      if (!/^[0-9a-f]{32}$/.test(c.key) || !/^[A-Za-z0-9]{40,}$/.test(c.token)) return json({ erro: 'Confira a chave (32 letras e números) e o token.' }, 400);
      const eu = await trello(c, '/members/me?fields=fullName,username');
      await db.from('crm_config').upsert({ chave: 'trello', valor: JSON.stringify({ ...c, nome: eu.fullName || eu.username }) });
      return json({ ok: true, nome: eu.fullName || eu.username });
    }
    const c = await credenciais();
    if (b.acao === 'config') return json({ configurado: !!c, nome: c?.nome ?? null });
    if (!c) return json({ erro: 'Conecte o Trello primeiro.', sem_trello: true }, 400);
    if (b.acao === 'quadro') return await quadro(c, String(b.link ?? '').trim());
    if (b.acao === 'anexo') return await anexo(c, b);
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    return json({ erro: e instanceof Error ? e.message : String(e) }, 500);
  }
});
