// Portal do cliente (crm-portal) no Node com banco de mentira: cada login só vê e mexe no que é do cliente dele.
//   node testes/teste_portal_funcao.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const erros = [];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) erros.push(m); };

// entregas são os mesmos objetos nas duas árvores (projeto → etapas → entregas e entrega → etapa → projeto)
const proj = (id, cliente_id, status, nome) => ({ id, cliente_id, status, nome, inicio: '2026-11-01', entrega_prevista: null, criado_em: '2026-11-01' });
const P = { p1: proj('p1', 'c1', 'ativo', 'Gestão de comunicação'), p0: proj('p0', 'c1', 'arquivado', 'Projeto antigo'), p2: proj('p2', 'c2', 'ativo', 'Projeto da Clínica') };
const U = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ent = (n, p, status, extra = {}) => ({ id: U(n), titulo: 'Entrega ' + n, ordem: n, status, prazo: null, link: null, formato: null, aprovado_em: null, atualizado_em: null, texto: null, crm_anexos: [], _p: p, ...extra });
const X = {
  x1: ent(1, 'p1', 'enviado', { titulo: 'Post de lançamento', texto: '## Legenda\nTexto final', link: 'https://canva.com/x', crm_anexos: [{ nome: 'post.png', caminho: 'p1/x1/post.png', tamanho: 1000 }] }),
  x2: ent(2, 'p1', 'produzindo', { texto: 'rascunho secreto', crm_anexos: [{ nome: 'rasc.pdf', caminho: 'p1/x2/rasc.pdf', tamanho: 10 }] }),
  x3: ent(3, 'p1', 'aprovado'),
  x9: ent(9, 'p0', 'enviado'),
  y1: ent(11, 'p2', 'enviado'),
  k1: ent(21, 'p1', 'enviado', { titulo: 'Guia de Publicação', texto: 'Como postar', _consulta: true }),
};
const etapa = (p, ents) => ({ id: 'e' + p, ordem: 1, titulo: 'Planejamento', orientacao: 'Oi, {{contato}}! Bem-vinda, {{empresa}}.', crm_entregas: ents });
for (const p of Object.values(P)) p.crm_etapas = [etapa(p.id, Object.values(X).filter(x => x._p === p.id && !x._consulta))];
P.p1.crm_etapas.push({ id: 'eguia', ordem: 2, titulo: 'Guia', orientacao: null, consulta: true, crm_entregas: [X.k1] });
for (const x of Object.values(X)) x.crm_etapas = { projeto_id: x._p, consulta: !!x._consulta, crm_projetos: P[x._p] };

const T = {
  crm_clientes: [{ id: U(101), nome: 'Paulo Mendes', empresa: 'Imobiliária Horizonte', estrategia: '## Posicionamento\nAlto padrão' }, { id: U(102), nome: 'Clara Dias', empresa: 'Clínica Dias' }],
  crm_projetos: Object.values(P), crm_entregas: Object.values(X), crm_tarefas: [], crm_interacoes: [],
  crm_config: [{ chave: 'cron_key', valor: 'k' }], admins: [{ email: 'adm@rovya' }],
  crm_portal: [{ user_id: 'u1', cliente_id: U(101), email: 'paulo@x' }, { user_id: 'u2', cliente_id: U(102), email: 'clara@x' }],
};
for (const p of Object.values(P)) p.cliente_id = p.cliente_id === 'c1' ? U(101) : U(102);
const C1 = U(101), C2 = U(102);
const usuarios = [
  { id: 'adm', email: 'adm@rovya', factors: [] }, { id: 'u1', email: 'paulo@x' }, { id: 'u2', email: 'clara@x' }, { id: 'u3', email: 'solto@x' },
  { id: 'fig', email: 'figurinha@x.com' }, { id: 'admfa', email: 'adm@rovya', factors: [{ status: 'verified' }] },
];
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select(_c, o) { if (this.op === 'select') this.head = o?.head; return this; }
  insert(v) { this.op = 'insert'; this.v = v; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  delete() { this.op = 'delete'; return this; }
  upsert(v) { this.op = 'upsert'; this.v = v; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  neq(k, v) { this.f.push(r => r[k] !== v); return this; }
  gte(k, v) { this.f.push(r => r[k] >= v); return this; }
  order() { return this; }
  limit() { return this; }
  maybeSingle() { this.um = true; return this; }
  then(res, rej) {
    const t = T[this.t] ||= [], casa = r => this.f.every(f => f(r));
    try {
      if (this.op === 'select') { const rs = t.filter(casa); return res(this.head ? { count: rs.length, error: null } : { data: this.um ? rs[0] ?? null : rs, error: null }); }
      if (this.op === 'insert') { t.push(...[].concat(this.v).map(r => ({ criado_em: new Date().toISOString(), status: 'a_fazer', ...r }))); return res({ error: null }); }
      if (this.op === 'update') { t.filter(casa).forEach(r => Object.assign(r, this.v)); return res({ error: null }); }
      if (this.op === 'upsert') { for (const r of [].concat(this.v)) { const x = t.find(y => y.user_id === r.user_id); x ? Object.assign(x, r) : t.push({ ...r }); } return res({ error: null }); }
      if (this.op === 'delete') { T[this.t] = t.filter(r => !casa(r)); return res({ error: null }); }
    } catch (e) { rej(e); }
  }
}
const novas = [], trocas = [], saidas = [];
globalThis.__db = {
  from: t => new Q(t),
  // as transações do portal ficam no banco (testadas no Supabase real, 024_fluxo.sql); aqui, a mesma regra em miniatura
  rpc: async (n, a) => {
    if (n === 'crm_portal_sair') saidas.push(a.p_user);
    if (n === 'crm_portal_entrega') {
      const x = T.crm_entregas.find(e => e.id === a.p_entrega), p = x && P[x._p];
      if (!x || p.cliente_id !== a.p_cliente || p.status === 'arquivado') return { data: { erro: 'Entrega não encontrada.', codigo: 404 } };
      if (x._consulta) return { data: { erro: 'Este cartão é só para consulta.', codigo: 409 } };
      if (x.status !== 'enviado') return { data: { erro: 'Esta entrega não está aguardando a sua aprovação.', codigo: 409 } };
      if (a.p_acao === 'aprovar') { x.status = 'aprovado'; T.crm_interacoes.push({ cliente_id: a.p_cliente, resumo: `Pelo portal: aprovou “${x.titulo}”` });
        return { data: { ok: true, titulo: x.titulo, projeto_id: p.id, etapa: 'Semana 01', etapa_completa: x._ultima ?? false } }; }
      if ((a.p_comentario || '').trim().length < 3) return { data: { erro: 'Conte o que você quer mudar.', codigo: 400 } };
      x.status = 'revisao'; x.revisoes = (x.revisoes || 0) + 1;
      T.crm_tarefas.push({ cliente_id: a.p_cliente, projeto_id: p.id, titulo: 'Ajuste pedido pelo cliente: ' + x.titulo, descricao: a.p_comentario, prioridade: 'alta', origem: 'portal', criado_em: new Date().toISOString() });
      return { data: { ok: true, titulo: x.titulo, projeto_id: p.id, revisoes: x.revisoes, inclusos: x._inclusos ?? null } };
    }
    if (n === 'crm_portal_pedido') {
      if ((a.p_titulo || '').length < 3) return { data: { erro: 'Dê um título para o pedido.', codigo: 400 } };
      if (T.crm_tarefas.filter(t => t.cliente_id === a.p_cliente && t.origem === 'portal' && t.titulo.startsWith('Pedido do cliente:')).length >= 10) return { data: { erro: 'Muitos pedidos hoje.', codigo: 429 } };
      T.crm_tarefas.push({ cliente_id: a.p_cliente, titulo: 'Pedido do cliente: ' + a.p_titulo, descricao: a.p_descricao, prioridade: 'media', origem: 'portal', status: 'a_fazer', criado_em: new Date().toISOString() });
      return { data: { ok: true, titulo: a.p_titulo } };
    }
    return { error: null };
  },
  auth: {
    getUser: async t => { const sub = JSON.parse(Buffer.from(t.split('.')[1], 'base64').toString()).sub; return { data: { user: usuarios.find(u => u.id === sub) ?? null } }; },
    admin: {
      listUsers: async () => ({ data: { users: usuarios }, error: null }),
      createUser: async o => { const u = { id: 'novo' + novas.length, email: o.email }; novas.push(o); usuarios.push(u); return { data: { user: u }, error: null }; },
      updateUserById: async (id, o) => { trocas.push({ id, ...o }); return { data: {}, error: null }; },
    },
  },
  storage: { from: () => ({ createSignedUrls: async ps => ({ data: ps.map(p => ({ path: p, signedUrl: 'https://assinada/' + p })) }) }) },
};
const avisos = [];
globalThis.fetch = async (url, o) => { if (String(url).includes('crm-assistente')) avisos.push(JSON.parse(o.body).aviso); return new Response('{}'); };
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sr' })[k] }, serve: h => globalThis.__h = h };
const src = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/crm-portal/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__db;');
await import('data:text/javascript,' + encodeURIComponent(src));
const tok = (sub, aal = 'aal1') => 'h.' + Buffer.from(JSON.stringify({ sub, aal })).toString('base64') + '.s';
const chamar = async (quem, corpo) => {
  const r = await globalThis.__h(new Request('https://x/functions/v1/crm-portal', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(quem ? { Authorization: 'Bearer ' + tok(...[].concat(quem)) } : {}) }, body: JSON.stringify(corpo) }));
  return { s: r.status, j: await r.json() };
};

// login
let r = await chamar(null, { acao: 'dados' }); ok(r.s === 401, 'sem login: 401');
r = await chamar('u3', { acao: 'dados' }); ok(r.s === 403 && r.j.sem_acesso, 'login sem vínculo com cliente: não vê nada');
ok(/Fale com a Rovya/.test(r.j.erro), 'login solto: manda falar com a Rovya');
// quem administra entra no portal com o mesmo login do CRM e escolhe o cliente
r = await chamar('adm', { acao: 'dados' }); ok(r.s === 200 && r.j.admin && r.j.clientes.length === 2 && r.j.cliente_id === C1 && r.j.cliente.nome === 'Paulo Mendes', 'conta do CRM no portal: entra e vê o primeiro cliente, com a lista para escolher');
r = await chamar('adm', { acao: 'dados', cliente_id: C2 }); ok(r.s === 200 && r.j.cliente_id === C2 && r.j.projetos[0].nome === 'Projeto da Clínica', 'conta do CRM: escolhe outro cliente e vê o portal dele');
r = await chamar('adm', { acao: 'dados', cliente_id: 'lixo' }); ok(r.s === 200 && r.j.cliente_id === C1, 'conta do CRM: cliente inválido cai no primeiro');
r = await chamar(['admfa', 'aal1'], { acao: 'dados' }); ok(r.s === 403 && r.j.sem_acesso, 'conta do CRM com verificação em duas etapas sem o código: não entra');
r = await chamar('u1', { acao: 'dados', cliente_id: C2 }); ok(r.s === 200 && !r.j.admin && !r.j.clientes && r.j.cliente.nome === 'Paulo Mendes', 'cliente mandando o id de outro cliente continua vendo só o dele');

// dados do cliente
r = await chamar('u1', { acao: 'dados' });
const corpo = JSON.stringify(r.j);
ok(r.s === 200 && r.j.projetos.length === 1 && r.j.projetos[0].nome === 'Gestão de comunicação', 'vê só o projeto ativo dele (arquivado e de outro cliente ficam de fora)');
ok(!corpo.includes('rascunho secreto') && !corpo.includes('rasc.pdf') && !('texto' in r.j.projetos[0].etapas[0].entregas.find(x => x.status === 'produzindo')), 'entrega em produção não mostra texto nem arquivo');
ok(!corpo.includes('caminho') && r.j.projetos[0].etapas[0].entregas[0].anexos[0].url === 'https://assinada/p1/x1/post.png', 'arquivo sai como link assinado, sem o caminho interno');
ok(r.j.projetos[0].etapas[0].orientacao === 'Oi, Paulo! Bem-vinda, Imobiliária Horizonte.', 'orientação com {{contato}} e {{empresa}} preenchidos');
ok(r.j.cliente.estrategia.startsWith('## Posicionamento') && !corpo.includes('Clínica'), 'estratégia dele e nada do outro cliente');
ok(T.crm_portal.find(a => a.user_id === 'u1').ultimo_acesso, 'grava o último acesso');
const guia = r.j.projetos[0].etapas[1];
ok(guia.consulta === true && r.j.projetos[0].etapas[0].consulta === false && guia.entregas[0].texto === 'Como postar', 'etapa só consulta vem marcada e com o texto');
let rc = await chamar('u1', { acao: 'aprovar', entrega_id: X.k1.id }); ok(rc.s === 409 && X.k1.status === 'enviado', 'cartão só consulta não é aprovado');
rc = await chamar('u1', { acao: 'alterar', entrega_id: X.k1.id, comentario: 'mudar' }); ok(rc.s === 409, 'nem recebe pedido de alteração');

// aprovar / alterar
r = await chamar('u1', { acao: 'aprovar', entrega_id: X.y1.id }); ok(r.s === 404 && X.y1.status === 'enviado', 'não aprova entrega de outro cliente');
r = await chamar('u1', { acao: 'aprovar', entrega_id: X.x9.id }); ok(r.s === 404, 'não aprova entrega de projeto arquivado');
r = await chamar('u1', { acao: 'aprovar', entrega_id: 'x; drop' }); ok(r.s === 404, 'id estranho: 404');
r = await chamar('u1', { acao: 'aprovar', entrega_id: X.x2.id }); ok(r.s === 409 && X.x2.status === 'produzindo', 'não aprova o que ainda está em produção');
r = await chamar('u1', { acao: 'aprovar', entrega_id: X.x1.id });
ok(r.s === 200 && X.x1.status === 'aprovado', 'aprova a entrega enviada');
ok(T.crm_interacoes.some(i => i.cliente_id === C1 && i.resumo.includes('aprovou “Post de lançamento”')) && avisos.at(-1)?.titulo.includes('Aprovado'), 'fica no histórico e avisa a Sabrina');
r = await chamar('u1', { acao: 'alterar', entrega_id: X.x1.id, comentario: 'mudar cor' }); ok(r.s === 409, 'já aprovada: não pede alteração');
X.x1.status = 'enviado';
r = await chamar('u1', { acao: 'alterar', entrega_id: X.x1.id, comentario: ' ' }); ok(r.s === 400 && X.x1.status === 'enviado', 'alteração sem comentário: recusa');
r = await chamar('u1', { acao: 'alterar', entrega_id: X.x1.id, comentario: 'Trocar a foto da capa' });
const tAj = T.crm_tarefas.find(t => t.titulo.includes('Ajuste'));
ok(r.s === 200 && X.x1.status === 'revisao' && tAj?.origem === 'portal' && tAj.prioridade === 'alta' && tAj.descricao === 'Trocar a foto da capa' && tAj.projeto_id === 'p1', 'pedir alteração: volta para revisão e vira tarefa de prioridade alta');
ok(avisos.at(-1).titulo === 'Cliente pediu alteração', 'dentro das rodadas do contrato: aviso normal');
X.x1.status = 'enviado'; X.x1._inclusos = 1;
await chamar('u1', { acao: 'alterar', entrega_id: X.x1.id, comentario: 'Mais uma mudança' });
ok(avisos.at(-1).titulo === 'Ajuste além do combinado (2º, contrato inclui 1)', 'passou das rodadas de ajuste do contrato: avisa diferente: ' + avisos.at(-1).titulo);
X.y1.status = 'enviado'; X.y1._ultima = true; await chamar('u2', { acao: 'aprovar', entrega_id: X.y1.id });
ok(avisos.at(-1).titulo === 'Semana 01 toda aprovada ✦', 'última peça da semana aprovada: avisa que a semana inteira foi aprovada');

// solicitações
r = await chamar('u1', { acao: 'pedir', titulo: 'ab' }); ok(r.s === 400, 'pedido sem título: recusa');
r = await chamar('u1', { acao: 'pedir', titulo: 'Post Dia das Mães', descricao: 'Até sexta' });
ok(r.s === 200 && T.crm_tarefas.some(t => t.titulo === 'Pedido do cliente: Post Dia das Mães' && t.origem === 'portal' && t.cliente_id === C1), 'nova solicitação vira tarefa');
T.crm_tarefas.push({ cliente_id: C2, titulo: 'Pedido do cliente: da Clara', origem: 'portal', status: 'a_fazer', criado_em: new Date().toISOString() });
T.crm_tarefas.push({ cliente_id: C1, titulo: 'Tarefa interna', origem: null, status: 'a_fazer', criado_em: new Date().toISOString() });
r = await chamar('u1', { acao: 'dados' });
ok(r.j.pedidos.length === T.crm_tarefas.filter(t => t.cliente_id === C1 && t.origem === 'portal').length && r.j.pedidos.length === 3 && !JSON.stringify(r.j.pedidos).includes('Clara') && !JSON.stringify(r.j.pedidos).includes('interna'), 'vê só as solicitações dele, sem as tarefas internas');
for (let i = 0; i < 9; i++) await chamar('u1', { acao: 'pedir', titulo: 'Pedido ' + i }); // ajustes não contam no limite
r = await chamar('u1', { acao: 'pedir', titulo: 'Mais um' }); ok(r.s === 429, 'limite de 10 solicitações por dia');

// administração (CRM)
r = await chamar('u1', { acao: 'convidar', cliente_id: C1, email: 'outro@x' }); ok(r.s === 403, 'cliente não cria acesso');
r = await chamar(['admfa', 'aal1'], { acao: 'convidar', cliente_id: C1, email: 'outro@x' }); ok(r.s === 403, 'admin com MFA sem o código: recusa');
r = await chamar('adm', { acao: 'convidar', cliente_id: C1, email: 'Socio@Horizonte.com' });
ok(r.s === 200 && /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(r.j.senha) && novas[0].email === 'socio@horizonte.com' && novas[0].user_metadata.trocar_senha === true && novas[0].email_confirm === true,
  'convida: cria login com senha provisória e pede troca no primeiro acesso: ' + r.j.senha);
ok(T.crm_portal.some(a => a.user_id === r.j.user_id && a.cliente_id === C1), 'vincula o login ao cliente');
r = await chamar('adm', { acao: 'convidar', cliente_id: C2, email: 'socio@horizonte.com' }); ok(r.s === 409, 'mesmo e-mail em outro cliente: recusa');
r = await chamar('adm', { acao: 'convidar', cliente_id: C1, email: 'adm@rovya' }); ok(r.s === 400, 'e-mail de admin não vira cliente');
r = await chamar('adm', { acao: 'convidar', cliente_id: C2, email: 'figurinha@x.com' });
ok(r.s === 200 && r.j.ja_tinha && novas.length === 1 && T.crm_portal.some(a => a.user_id === 'fig' && a.cliente_id === C2), 'e-mail que já tinha login: vincula ao cliente');
ok(trocas.at(-1).id === 'fig' && trocas.at(-1).password === r.j.senha && trocas.at(-1).user_metadata.trocar_senha && saidas.includes('fig'), 'conta criada antes por outra pessoa não entra: senha vira a provisória e as sessões caem');
const nTrocas = trocas.length;
r = await chamar('adm', { acao: 'nova_senha', user_id: 'u1' }); ok(r.s === 404, 'user_id fora do formato: 404');
T.crm_portal.find(a => a.user_id === 'u1').user_id = U(201); usuarios.find(u => u.id === 'u1').id = U(201);
r = await chamar('adm', { acao: 'nova_senha', user_id: U(201) });
ok(r.s === 200 && trocas.at(-1).id === U(201) && trocas.at(-1).password === r.j.senha && trocas.at(-1).user_metadata.trocar_senha && saidas.at(-1) === U(201), 'nova senha provisória e quem estava logado sai');
T.crm_portal.push({ user_id: U(202), cliente_id: C1, email: 'adm@rovya' });
r = await chamar('adm', { acao: 'nova_senha', user_id: U(202) }); ok(r.s === 404 && trocas.length === nTrocas + 1, 'nunca troca a senha de quem administra');
r = await chamar('adm', { acao: 'remover', user_id: U(201) }); ok(r.s === 200 && !T.crm_portal.some(a => a.user_id === U(201)), 'remove o acesso');
r = await chamar(U(201), { acao: 'dados' }); ok(r.s === 403, 'depois de removido, não vê mais nada');

console.log('ERROS:', erros.length ? erros : 'nenhum'); process.exit(erros.length ? 1 : 0);
