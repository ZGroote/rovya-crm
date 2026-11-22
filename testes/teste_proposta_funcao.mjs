// Proposta aceita online (crm-proposta) no Node com banco de mentira. As regras do aceite ficam no banco
// (crm_proposta_aceitar, testada no Supabase real com rollback); aqui: link, IP, aviso e respostas.
//   node testes/teste_proposta_funcao.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const erros = [];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) erros.push(m); };
const TOK = 'ab'.repeat(16), rpcs = [], avisos = [];
let aceita = false;
globalThis.__db = {
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { valor: 'k' } }) }) }) }),
  rpc: async (n, a) => {
    rpcs.push([n, a]);
    if (n === 'crm_proposta_publica') return { data: a.p_token === TOK ? { titulo: 'Gestão de redes', status: 'enviada' } : null };
    if (aceita) return { data: { ok: true, ja: true, aceite_nome: 'Carla Dias', aceite_em: 'x' } };
    if ((a.p_nome || '').trim().length < 3) return { data: { erro: 'Escreva seu nome completo.', codigo: 400 } };
    aceita = true; return { data: { ok: true, id: 'pp3', titulo: 'Gestão de redes', empresa: 'Clínica Dias', aceite_nome: a.p_nome, aceite_em: 'x' } };
  },
};
globalThis.fetch = async (url, o) => { if (String(url).includes('crm-assistente')) avisos.push(JSON.parse(o.body).aviso); return new Response('{}'); };
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sr' })[k] }, serve: h => globalThis.__h = h };
const src = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/crm-proposta/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__db;');
await import('data:text/javascript,' + encodeURIComponent(src));
const chamar = async (corpo, h = {}) => { const r = await globalThis.__h(new Request('https://x/functions/v1/crm-proposta', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(corpo) })); return { s: r.status, j: await r.json() }; };

let r = await chamar({ acao: 'ver', token: "x' or 1=1" }); ok(r.s === 404 && !rpcs.length, 'link fora do formato: 404 sem ir ao banco');
r = await chamar({ acao: 'ver', token: 'cd'.repeat(16) }); ok(r.s === 404, 'link que não existe: 404');
r = await chamar({ acao: 'ver', token: TOK }); ok(r.s === 200 && r.j.titulo === 'Gestão de redes', 'abre a proposta pelo link');
r = await chamar({ acao: 'aceitar', token: TOK, nome: 'ab' }); ok(r.s === 400 && !avisos.length, 'nome curto: recusa e não avisa');
r = await chamar({ acao: 'aceitar', token: TOK, nome: 'Carla Dias' }, { 'x-forwarded-for': '200.1.2.3, 10.0.0.1' });
ok(r.s === 200 && r.j.aceite_nome === 'Carla Dias', 'aceita');
ok(rpcs.at(-1)[1].p_ip === '200.1.2.3', 'guarda o IP de quem aceitou (o primeiro da lista)');
ok(avisos.length === 1 && avisos[0].titulo === 'Proposta aceita ✦' && avisos[0].corpo.includes('Clínica Dias') && avisos[0].url === 'app.html#/proposta/pp3', 'avisa a Sabrina no celular');
r = await chamar({ acao: 'aceitar', token: TOK, nome: 'Outra Pessoa' }); ok(r.s === 200 && r.j.aceite_nome === 'Carla Dias' && avisos.length === 1, 'aceitar de novo: devolve o aceite que já existe e não avisa de novo');
r = await chamar({ acao: 'apagar', token: TOK }); ok(r.s === 400, 'ação desconhecida: 400');
const op = await globalThis.__h(new Request('https://x', { method: 'OPTIONS' })); ok(op.status === 200, 'OPTIONS do navegador: 200');
console.log('ERROS:', erros.length ? erros : 'nenhum'); process.exit(erros.length ? 1 : 0);
