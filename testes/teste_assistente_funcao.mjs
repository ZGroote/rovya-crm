// Função crm-assistente no Node com Gemini, banco e push de mentira.
// Confere: ações propostas pela IA voltam como cartões (sem gravar nada), a tela aberta vai para a IA,
// e o aviso das 7h30 junta o que precisa de atenção (e às sextas a semana).
//   node testes/teste_assistente_funcao.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const erros = [];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) erros.push(m); };
const dia = d => new Date(Date.now() + d * 864e5).toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' });

// ---- banco de mentira: filtros simples (eq/in/gte); or/order/neq/not/is/limit não filtram ----
const T = {
  admins: [{ email: 'sa@x.com' }], crm_config: [{ chave: 'cron_key', valor: 'k' }, { chave: 'vapid', valor: '{}' }], crm_push: [{ endpoint: 'e1', inscricao: {} }],
  crm_google: [], crm_clientes: [{ id: 'c1', nome: 'Paulo', empresa: 'Horizonte', criado_em: dia(-2) }, { id: 'c2', nome: 'Marina', empresa: null, criado_em: dia(-90) }],
  crm_oportunidades: [{ id: 'o1', cliente_id: 'c2', titulo: 'Identidade', etapa: 'proposta', atualizado_em: dia(-30), crm_clientes: { nome: 'Marina' } },
    { id: 'o2', cliente_id: 'c1', titulo: 'Gestão', etapa: 'negociacao', atualizado_em: dia(-1), crm_clientes: { nome: 'Paulo', empresa: 'Horizonte' } }],
  crm_interacoes: [{ id: 'i1', cliente_id: 'c1', data: dia(-2), tipo: 'reuniao', resumo: 'Kickoff' }, { id: 'i2', cliente_id: 'c2', data: dia(-20), tipo: 'mensagem', resumo: 'Mandei a proposta' }],
  crm_projetos: [], crm_tarefas: [{ id: 't1', status: 'feita', concluida_em: dia(-1) }],
  crm_parcelas: [{ id: 'p1', tipo: 'receita', valor: 2000, vencimento: dia(-3), pago_em: null }, { id: 'p2', tipo: 'receita', valor: 1500, vencimento: dia(-5), pago_em: dia(-2) }],
  crm_contratos: [{ id: 'k1', titulo: 'Gestão', status: 'vigente', fim: dia(20), aviso_dias: 30, crm_clientes: { nome: 'Paulo', empresa: 'Horizonte' } }],
  crm_propostas: [{ id: 'pp1', grupo: 'g1', versao: 1, status: 'enviada', validade: dia(2), crm_clientes: { nome: 'Marina' } }],
};
class Q {
  constructor(t) { this.t = t; this.f = []; }
  select(_c, o) { this.o = o || {}; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  in(k, l) { this.f.push(r => l.includes(r[k])); return this; }
  gte(k, v) { this.f.push(r => (r[k] ?? '') >= v); return this; }
  not(k, op, v) { if (op === 'is' && v === null) this.f.push(r => r[k] != null); return this; }
  or() { return this; } order() { return this; } neq() { return this; } is() { return this; } limit() { return this; }
  maybeSingle() { this.um = true; return this; }
  insert() { return this; } delete() { return this; }
  then(res) { const rs = (T[this.t] || []).filter(r => this.f.every(f => f(r))); return res(this.o?.head ? { count: rs.length } : { data: this.um ? rs[0] ?? null : rs }); }
}
globalThis.__db = { from: t => new Q(t), auth: { getUser: async () => ({ data: { user: { email: 'sa@x.com', factors: [] } } }) } };

// ---- push e Gemini de mentira ----
const pushes = [];
globalThis.__webpush = { importVapidKeys: async () => ({}), exportApplicationServerKey: async () => 'pub',
  ApplicationServer: { new: async () => ({ subscribe: () => ({ pushTextMessage: async m => pushes.push(JSON.parse(m)) }) }) } };
let pedido, resposta;
globalThis.fetch = async (url, init = {}) => {
  if (String(url).includes('generativelanguage')) { pedido = JSON.parse(init.body); return new Response(JSON.stringify(resposta)); }
  throw new Error('fetch inesperado: ' + url);
};
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sr', GEMINI_API_KEY: 'g' })[k] }, serve: h => globalThis.__h = h };

const src = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/crm-assistente/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__db;')
  .replace(/import \* as webpush from 'jsr:@negrel\/webpush@\^0\.5\.0';/, 'const webpush = globalThis.__webpush;');
await import('data:text/javascript,' + encodeURIComponent(src));
const tk = 'x.' + Buffer.from(JSON.stringify({ aal: 'aal1' })).toString('base64url') + '.y';
const chamar = async (corpo, h = { Authorization: 'Bearer ' + tk }) => { const r = await globalThis.__h(new Request('https://x/functions/v1/crm-assistente', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(corpo) })); return { status: r.status, ...(await r.json()) }; };

// 1) ações: a IA chama ferramentas → voltam como cartões; nada é gravado
resposta = { candidates: [{ content: { parts: [
  { text: 'Preparei a tarefa e o e-mail.' },
  { functionCall: { name: 'criar_tarefa', args: { rotulo: 'Tarefa: ligar para a Marina', titulo: 'Ligar para a Marina', prazo: dia(1), cliente_id: 'c2' } } },
  { functionCall: { name: 'escrever_email', args: { rotulo: 'E-mail para o Paulo', cliente_id: 'c1', assunto: 'Oi', texto: 'Oi, Paulo!' } } },
  { functionCall: { name: 'apagar_tudo', args: {} } }] } }] };
let r = await chamar({ acao: 'chat', mensagens: [{ role: 'user', content: 'cria tarefa e e-mail' }], contexto: { rota: 'cliente', id: 'c1' } });
ok(r.resposta === 'Preparei a tarefa e o e-mail.' && r.acoes.map(a => a.nome).join() === 'criar_tarefa,escrever_email', `volta o texto e os cartões (ferramenta desconhecida fica de fora): ${r.acoes?.map(a => a.nome)}`);
ok(r.acoes[0].args.titulo === 'Ligar para a Marina', 'argumentos da ação chegam inteiros');
const nomes = pedido.tools[0].functionDeclarations.map(f => f.name);
ok(['criar_tarefa', 'registrar_contato', 'mover_oportunidade', 'marcar_pago', 'agendar_compromisso', 'escrever_email', 'escrever_whatsapp', 'rascunho_proposta'].every(n => nomes.includes(n)), 'a IA recebe as 8 ferramentas');
const sis = pedido.systemInstruction.parts[0].text;
ok(/TELA ABERTA:[\s\S]*"tela":"cliente"[\s\S]*"nome":"Paulo"[\s\S]*Kickoff/.test(sis), 'a ficha aberta (e o histórico desse cliente) vai para a IA');
ok(/"id":"c2"/.test(sis) && /"id":"o1"/.test(sis) && /"id":"p1"/.test(sis), 'os dados levam os ids (para a IA propor ações)');
ok(!/\n\nTELA ABERTA:\n/.test(((await chamar({ acao: 'chat', mensagens: [{ role: 'user', content: 'oi' }] })), pedido.systemInstruction.parts[0].text)), 'sem tela aberta, não manda nada');
await chamar({ acao: 'chat', mensagens: [{ role: 'user', content: 'oi' }], contexto: { rota: 'cliente', id: "c1' or 1=1" } });
ok(!/"registro"/.test(pedido.systemInstruction.parts[0].text), 'id estranho na tela aberta é ignorado');
resposta = { candidates: [{ content: { parts: [{ functionCall: { name: 'marcar_pago', args: { rotulo: 'Pago', lancamento_id: 'p1' } } }] } }] };
r = await chamar({ acao: 'chat', mensagens: [{ role: 'user', content: 'marca pago' }] });
ok(r.resposta === 'Preparei para você conferir:' && r.acoes.length === 1, 'só ação, sem texto: frase padrão');
ok((await chamar({ acao: 'chat', mensagens: [] }, {})).status === 401, 'sem login: recusado');

// 2) avisos das 7h30
const cron = () => chamar({}, { 'x-cron': 'k' });
pushes.length = 0; await cron();
const at = pushes.find(p => p.title === 'Precisa da sua atenção');
ok(pushes[0]?.title.startsWith('Bom dia') && at, `resumo + "precisa da sua atenção": ${pushes.map(p => p.title).join(' | ')}`);
ok(at && /sem retorno.*Marina/.test(at.body) && !/sem retorno[^•]*Paulo/.test(at.body), `cliente sem contato há 10+ dias (Marina sim, Paulo não): ${at?.body}`);
ok(at && /proposta de Marina vence em 2 dia/.test(at.body), 'proposta enviada vencendo em até 3 dias');
ok(at && /contrato de Horizonte \(Paulo\) termina/.test(at.body), 'contrato dentro do prazo de aviso');
ok(at && /1 parcela\(s\) atrasada\(s\): R\$\s?2\.000,00/.test(at.body), 'parcela atrasada com o total');
ok(at && at.body.length <= 200, `cabe na notificação (${at?.body.length} caracteres)`);
const sexta = new Date().toLocaleDateString('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short' }) === 'Fri';
ok(sexta === pushes.some(p => p.title === 'Sua semana ✦'), `"sua semana" só às sextas (hoje ${sexta ? 'é' : 'não é'} sexta)`);
// sexta de mentira: confere o texto da semana
const D0 = Date.prototype.toLocaleDateString;
Date.prototype.toLocaleDateString = function (l, o) { return o?.weekday === 'short' && l === 'en-US' ? 'Fri' : D0.call(this, l, o); };
pushes.length = 0; await cron(); Date.prototype.toLocaleDateString = D0;
const sem = pushes.find(p => p.title === 'Sua semana ✦');
ok(sem && /1 tarefa\(s\) feita\(s\)/.test(sem.body) && /R\$\s?1\.500,00 recebido/.test(sem.body) && /1 cliente\(s\) novo\(s\)/.test(sem.body), `sexta: a semana em números: ${sem?.body}`);
// nada parado: só o resumo
T.crm_parcelas[0].pago_em = dia(0); T.crm_propostas[0].status = 'aprovada'; T.crm_contratos[0].fim = dia(200); T.crm_interacoes[1].data = dia(-1);
pushes.length = 0; await cron();
ok(!pushes.some(p => p.title === 'Precisa da sua atenção'), 'nada parado: não manda o aviso de atenção');
ok((await chamar({}, { 'x-cron': 'errada' })).status === 401, 'cron com chave errada: recusado');

console.log('ERROS:', erros.length ? erros : 'nenhum'); process.exit(erros.length ? 1 : 0);
