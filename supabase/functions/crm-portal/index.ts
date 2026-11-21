// Portal do cliente (rovyacreative.com.br/portal), fase 1.
// O cliente entra com e-mail e senha, mas não tem acesso às tabelas do CRM (as políticas são só admin + MFA).
// Esta função confere quem está logado em crm_portal (user_id → cliente_id) e devolve SÓ os dados daquele cliente.
// Cliente: {acao:'dados'} | {acao:'aprovar', entrega_id} | {acao:'alterar', entrega_id, comentario} | {acao:'pedir', titulo, descricao}
// CRM (admin, com MFA quando ativado): {acao:'convidar', cliente_id, email} | {acao:'nova_senha', user_id} | {acao:'remover', user_id}
// O cliente só vê texto, link e arquivos de uma entrega depois que a Sabrina a envia (status enviado, revisao ou aprovado):
// rascunho em produção não sai daqui. Projeto arquivado também não. Etapa "só consulta" (crm_etapas.consulta): o cliente lê, não aprova.
// Deploy com verify_jwt = false (o OPTIONS do navegador chega sem login; o login é conferido aqui).
import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const txt = (v: unknown, max: number) => String(v ?? '').trim().slice(0, max);
const EMAIL = /^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ENTREGUE = ['enviado', 'revisao', 'aprovado'];
const PEDIDOS_POR_DIA = 10;

async function logado(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!t || t.split('.').length !== 3) return null;
  const { data } = await db.auth.getUser(t);
  if (!data?.user) return null;
  const aal = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
  return { user: data.user, aal };
}
// mesma regra do crm-google: está em admins e, se tem MFA, entrou com o código
async function eAdmin(u: { user: any, aal: string }) {
  if (!u.user.email) return false;
  if (u.user.factors?.some((f: any) => f.status === 'verified') && u.aal !== 'aal2') return false;
  const { data } = await db.from('admins').select('email').eq('email', u.user.email).maybeSingle();
  return !!data;
}

// aviso no celular da Sabrina (pela função do assistente, que guarda as inscrições de notificação)
async function avisar(titulo: string, corpo: string, url: string) {
  const { data: k } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
  if (k?.valor) await fetch(`${SUPA}/functions/v1/crm-assistente`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-cron': k.valor },
    body: JSON.stringify({ aviso: { titulo, corpo, url } }) }).catch(() => { });
}
const preencher = (t: string, c: any) => (t || '')
  .replaceAll('{{empresa}}', c?.empresa || c?.nome || '').replaceAll('{{contato}}', (c?.nome || '').split(' ')[0]).replaceAll('{{cliente}}', c?.nome || '');
// senha provisória fácil de ditar (sem 0/O, 1/l/I)
function senhaProvisoria() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789', n = crypto.getRandomValues(new Uint8Array(12));
  return [...n].map((x, i) => (i && i % 4 === 0 ? '-' : '') + A[x % A.length]).join('');
}

/* ---------- cliente ---------- */
async function dados(cid: string) {
  const { data: c } = await db.from('crm_clientes').select('nome,empresa,estrategia').eq('id', cid).maybeSingle();
  const { data: ps } = await db.from('crm_projetos')
    .select('id,nome,status,inicio,entrega_prevista,crm_etapas(id,ordem,titulo,orientacao,consulta,crm_entregas(id,ordem,titulo,texto,status,prazo,link,formato,aprovado_em,atualizado_em,crm_anexos(nome,caminho,tamanho,criado_em)))')
    .eq('cliente_id', cid).neq('status', 'arquivado').order('criado_em', { ascending: false });
  const caminhos: string[] = [];
  for (const p of ps ?? []) for (const e of p.crm_etapas) for (const x of e.crm_entregas) if (ENTREGUE.includes(x.status)) caminhos.push(...x.crm_anexos.map((a: any) => a.caminho));
  const urls = new Map<string, string>();
  if (caminhos.length) {
    const { data } = await db.storage.from('crm-anexos').createSignedUrls(caminhos, 3600);
    for (const u of data ?? []) if (u.signedUrl) urls.set(u.path!, u.signedUrl);
  }
  const projetos = (ps ?? []).map((p: any) => ({
    id: p.id, nome: p.nome, status: p.status, inicio: p.inicio, entrega_prevista: p.entrega_prevista,
    etapas: p.crm_etapas.sort((a: any, b: any) => a.ordem - b.ordem).map((e: any) => ({
      titulo: e.titulo, orientacao: preencher(e.orientacao, c), consulta: !!e.consulta,
      entregas: e.crm_entregas.sort((a: any, b: any) => a.ordem - b.ordem).map((x: any) => {
        const base = { id: x.id, titulo: x.titulo, status: x.status, prazo: x.prazo, formato: x.formato };
        return ENTREGUE.includes(x.status) ? { ...base, texto: x.texto, link: x.link, aprovado_em: x.aprovado_em, atualizado_em: x.atualizado_em,
          anexos: x.crm_anexos.map((a: any) => ({ nome: a.nome, tamanho: a.tamanho, url: urls.get(a.caminho) ?? null })) } : base;
      }),
    })),
  }));
  const { data: pedidos } = await db.from('crm_tarefas').select('titulo,descricao,status,criado_em,concluida_em')
    .eq('cliente_id', cid).eq('origem', 'portal').order('criado_em', { ascending: false }).limit(30);
  return { cliente: { nome: c?.nome, empresa: c?.empresa, estrategia: c?.estrategia ?? null }, projetos, pedidos: pedidos ?? [] };
}

// a entrega é de um projeto (não arquivado) deste cliente?
async function minhaEntrega(cid: string, id: unknown) {
  if (!UUID.test(String(id))) return null;
  const { data: x } = await db.from('crm_entregas').select('id,titulo,status,crm_etapas(projeto_id,consulta,crm_projetos(id,nome,status,cliente_id))').eq('id', id).maybeSingle();
  const p = x?.crm_etapas?.crm_projetos;
  return p && p.cliente_id === cid && p.status !== 'arquivado' ? { ...x, projeto: p, consulta: !!x.crm_etapas.consulta } : null;
}

async function historico(cid: string, resumo: string) {
  await db.from('crm_interacoes').insert({ cliente_id: cid, tipo: 'mensagem', resumo });
}

async function agirNaEntrega(cid: string, nome: string, b: Record<string, unknown>): Promise<[unknown, number]> {
  const x = await minhaEntrega(cid, b.entrega_id);
  if (!x) return [{ erro: 'Entrega não encontrada.' }, 404];
  if (x.consulta) return [{ erro: 'Este cartão é só para consulta.' }, 409];
  if (x.status !== 'enviado') return [{ erro: 'Esta entrega não está aguardando a sua aprovação.' }, 409];
  const agora = new Date().toISOString();
  if (b.acao === 'aprovar') {
    await db.from('crm_entregas').update({ status: 'aprovado', atualizado_em: agora }).eq('id', x.id);
    await historico(cid, `Pelo portal: aprovou “${x.titulo}” (${x.projeto.nome}).`);
    await avisar('Aprovado pelo cliente ✦', `${nome} aprovou “${x.titulo}”`, `app.html#/projeto/${x.projeto.id}`);
    return [{ ok: true }, 200];
  }
  const comentario = txt(b.comentario, 2000);
  if (comentario.length < 3) return [{ erro: 'Conte o que você quer mudar.' }, 400];
  await db.from('crm_entregas').update({ status: 'revisao', atualizado_em: agora }).eq('id', x.id);
  await db.from('crm_tarefas').insert({ cliente_id: cid, projeto_id: x.projeto.id, titulo: `Ajuste pedido pelo cliente: ${x.titulo}`.slice(0, 200),
    descricao: comentario, prioridade: 'alta', origem: 'portal' });
  await historico(cid, `Pelo portal: pediu alteração em “${x.titulo}” (${x.projeto.nome}).\n\n${comentario}`);
  await avisar('Cliente pediu alteração', `${nome} · “${x.titulo}”: ${comentario.slice(0, 80)}`, `app.html#/projeto/${x.projeto.id}`);
  return [{ ok: true }, 200];
}

async function pedir(cid: string, nome: string, b: Record<string, unknown>): Promise<[unknown, number]> {
  const titulo = txt(b.titulo, 150), descricao = txt(b.descricao, 3000);
  if (titulo.length < 3) return [{ erro: 'Dê um título para o pedido.' }, 400];
  const { count } = await db.from('crm_tarefas').select('id', { count: 'exact', head: true }).eq('cliente_id', cid).eq('origem', 'portal')
    .gte('criado_em', new Date(Date.now() - 864e5).toISOString());
  if ((count ?? 0) >= PEDIDOS_POR_DIA) return [{ erro: 'Muitos pedidos hoje. Fale com a Rovya pelo WhatsApp.' }, 429];
  await db.from('crm_tarefas').insert({ cliente_id: cid, titulo: `Pedido do cliente: ${titulo}`, descricao: descricao || null, prioridade: 'media', origem: 'portal' });
  await historico(cid, `Pelo portal: nova solicitação “${titulo}”.${descricao ? '\n\n' + descricao : ''}`);
  await avisar('Nova solicitação de cliente ✦', `${nome} · ${titulo}`, 'app.html#/tarefas');
  return [{ ok: true }, 200];
}

/* ---------- CRM (admin) ---------- */
async function acharUsuario(email: string) {
  for (let page = 1; ; page++) { // ponytail: varre a lista de logins; com dezenas de milhares de contas, trocar por uma consulta em auth.users
    const { data, error } = await db.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const u = data.users.find((x: any) => x.email?.toLowerCase() === email);
    if (u || data.users.length < 1000) return u ?? null;
  }
}
async function eLoginDoPortal(id: unknown) {
  if (!UUID.test(String(id))) return null;
  const { data } = await db.from('crm_portal').select('user_id,email').eq('user_id', id).maybeSingle();
  if (!data) return null;
  const { data: adm } = await db.from('admins').select('email').eq('email', data.email).maybeSingle();
  return adm ? null : data; // nunca mexe na senha de quem administra o CRM
}

async function admin(b: Record<string, unknown>): Promise<[unknown, number]> {
  if (b.acao === 'convidar') {
    const email = txt(b.email, 160).toLowerCase();
    if (!EMAIL.test(email)) return [{ erro: 'E-mail inválido.' }, 400];
    if (!UUID.test(String(b.cliente_id))) return [{ erro: 'Cliente inválido.' }, 400];
    const { data: c } = await db.from('crm_clientes').select('id,nome').eq('id', b.cliente_id).maybeSingle();
    if (!c) return [{ erro: 'Cliente não encontrado.' }, 404];
    const { data: adm } = await db.from('admins').select('email').eq('email', email).maybeSingle();
    if (adm) return [{ erro: 'Esse e-mail é de quem administra o CRM. Use o e-mail do cliente.' }, 400];
    let u = await acharUsuario(email);
    const senha = senhaProvisoria(), ja_tinha = !!u;
    if (u) {
      const { data: ja } = await db.from('crm_portal').select('cliente_id').eq('user_id', u.id).maybeSingle();
      if (ja && ja.cliente_id !== c.id) return [{ erro: 'Esse e-mail já entra no portal de outro cliente.' }, 409];
      // e-mail que já tinha login (ex.: cadastro aberto das figurinhas): alguém pode ter criado a conta antes do cliente.
      // Por isso a senha vira a provisória e as sessões abertas caem; só quem recebe a mensagem da Sabrina entra.
      const { error } = await db.auth.admin.updateUserById(u.id, { password: senha, email_confirm: true, user_metadata: { trocar_senha: true } });
      if (error) return [{ erro: 'Não consegui preparar o login: ' + error.message }, 500];
      await db.rpc('crm_portal_sair', { p_user: u.id });
    } else {
      const { data, error } = await db.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { trocar_senha: true } });
      if (error || !data.user) return [{ erro: 'Não consegui criar o login: ' + (error?.message ?? '') }, 500];
      u = data.user;
    }
    await db.from('crm_portal').upsert({ user_id: u.id, cliente_id: c.id, email });
    return [{ ok: true, user_id: u.id, senha, ja_tinha }, 200];
  }
  const p = await eLoginDoPortal(b.user_id);
  if (!p) return [{ erro: 'Acesso não encontrado.' }, 404];
  if (b.acao === 'nova_senha') {
    const senha = senhaProvisoria();
    const { error } = await db.auth.admin.updateUserById(p.user_id, { password: senha, user_metadata: { trocar_senha: true } });
    if (error) return [{ erro: 'Não consegui trocar a senha: ' + error.message }, 500];
    await db.rpc('crm_portal_sair', { p_user: p.user_id }); // aparelho perdido ou senha vazada: quem estava logado sai
    return [{ ok: true, senha }, 200];
  }
  if (b.acao === 'remover') {
    await db.from('crm_portal').delete().eq('user_id', p.user_id); // o login continua existindo (pode ser das figurinhas), mas não vê mais nada aqui
    return [{ ok: true }, 200];
  }
  return [{ erro: 'Ação desconhecida.' }, 400];
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ erro: 'Use POST.' }, 405);
  try {
    const u = await logado(req);
    if (!u) return json({ erro: 'Entre de novo.' }, 401);
    const b = await req.json().catch(() => ({})) as Record<string, unknown>;
    if (['convidar', 'nova_senha', 'remover'].includes(String(b.acao))) {
      if (!await eAdmin(u)) return json({ erro: 'Sem permissão.' }, 403);
      const [r, s] = await admin(b); return json(r, s);
    }
    const { data: acesso } = await db.from('crm_portal').select('cliente_id').eq('user_id', u.user.id).maybeSingle();
    if (!acesso) return json({ erro: 'Este login ainda não tem acesso ao portal. Fale com a Rovya.', sem_acesso: true }, 403);
    const cid = acesso.cliente_id as string;
    if (b.acao === 'dados') {
      await db.from('crm_portal').update({ ultimo_acesso: new Date().toISOString() }).eq('user_id', u.user.id);
      return json(await dados(cid));
    }
    const { data: c } = await db.from('crm_clientes').select('nome,empresa').eq('id', cid).maybeSingle();
    const nome = c?.empresa || c?.nome || 'Cliente';
    if (b.acao === 'aprovar' || b.acao === 'alterar') { const [r, s] = await agirNaEntrega(cid, nome, b); return json(r, s); }
    if (b.acao === 'pedir') { const [r, s] = await pedir(cid, nome, b); return json(r, s); }
    return json({ erro: 'Ação desconhecida.' }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: 'Falha no portal. Tente de novo em instantes.' }, 500);
  }
});
