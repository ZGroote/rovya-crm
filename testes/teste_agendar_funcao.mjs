// Função pública crm-agendar rodando no Node com Google e banco de mentira.
// Confere a conta dos horários livres (reserva − ocupado) e o fluxo de reservar (trava, cliente, convite, aviso).
//   node testes/teste_agendar_funcao.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const erros = [];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) erros.push(m); };

// ---- banco de mentira (só o que a função usa) ----
const T = {
  crm_google: [{ id: 1, refresh_token: 'rt', agendas: { profissional: 'prof', pessoal: 'pes' } }],
  crm_clientes: [{ id: 'c1', nome: 'Ana', email: 'Ana@Exemplo.com' }], crm_agendamentos: [], crm_interacoes: [], crm_oportunidades: [],
  crm_config: [{ chave: 'cron_key', valor: 'k' }], crm_falhas: [],
};
let n = 0;
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select(_c, o) { if (this.op === 'select') this.o = o || {}; return this; }
  insert(v) { this.op = 'insert'; this.v = v; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  delete() { this.op = 'delete'; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  gte(k, v) { this.f.push(r => r[k] >= v); return this; }
  ilike(k, v) { const x = v.replace(/\\(.)/g, '$1').toLowerCase(); this.f.push(r => (r[k] || '').toLowerCase() === x); return this; }
  not(k, _op, lista) { const l = lista.replace(/[()]/g, '').split(','); this.f.push(r => !l.includes(r[k])); return this; }
  limit() { return this; }
  maybeSingle() { this.um = true; return this; }
  single() { this.um = true; return this; }
  then(res) {
    const t = T[this.t] ||= [], casa = r => this.f.every(f => f(r));
    if (this.op === 'select') {
      const rs = t.filter(casa);
      return res(this.o?.head ? { count: rs.length } : { data: this.um ? rs[0] ?? null : rs });
    }
    if (this.op === 'insert') {
      const rs = [].concat(this.v).map(r => ({ id: 'id' + ++n, criado_em: new Date().toISOString(), ...(this.t === 'crm_agendamentos' ? { status: 'confirmado' } : {}), ...r }));
      if (this.t === 'crm_agendamentos' && rs.some(r => t.some(x => x.status === 'confirmado' && x.inicio === r.inicio))) return res({ data: null, error: { code: '23505' } });
      t.push(...rs); return res({ data: this.um ? rs[0] : rs, error: null });
    }
    if (this.op === 'update') { t.filter(casa).forEach(r => Object.assign(r, this.v)); return res({ error: null }); }
    if (this.op === 'delete') { T[this.t] = t.filter(r => !casa(r)); return res({ error: null }); }
  }
}
globalThis.__db = { from: t => new Q(t) };

// ---- Google de mentira ----
const BR = (dias, hm) => { const d = new Date(Date.now() + dias * 864e5).toLocaleDateString('sv', { timeZone: 'America/Sao_Paulo' }); return new Date(`${d}T${hm}:00-03:00`).toISOString(); };
const ev = (id, ini, fim, x = {}) => ({ id, start: { dateTime: ini }, end: { dateTime: fim }, ...x });
const res = { crm_reserva: '1', crm_slot: '60' };
const G = {
  prof: [
    ev('r1', BR(3, '14:00'), BR(3, '17:00'), { transparency: 'transparent', extendedProperties: { private: res } }), // reserva: 14, 15, 16
    ev('r0', BR(0, '00:00'), BR(0, '00:30'), { extendedProperties: { private: res } }),                            // reserva de hoje cedo: antes das 12 h de antecedência
    ev('a', BR(3, '14:00'), BR(3, '15:00'), { transparency: 'transparent' }),                                        // "livre": não bloqueia
    ev('b', BR(3, '14:00'), BR(3, '14:30'), { attendees: [{ self: true, responseStatus: 'declined' }] }),            // recusado: não bloqueia
    ev('c', BR(3, '16:30'), BR(3, '17:00')),                                                                         // ocupado: tira as 16h
  ],
  pes: [ev('d', BR(3, '15:00'), BR(3, '15:30'))],                                                                   // pessoal: tira as 15h
};
const criados = [], avisos = []; let mostrarCriados = true, eventoApagado = false;
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url), r = (o, s = 200) => new Response(JSON.stringify(o), { status: s });
  if (u.host === 'oauth2.googleapis.com') return r({ access_token: 'at' });
  if (u.pathname.endsWith('/crm-assistente')) { avisos.push({ cron: init.headers['x-cron'], ...JSON.parse(init.body) }); return r({}); }
  const m = u.pathname.match(/calendars\/([^/]+)\/events(?:\/(.+))?$/);
  if (m) {
    const cal = decodeURIComponent(m[1]);
    if (m[2]) return eventoApagado ? r({ error: { message: 'Not Found' } }, 404) : r({ id: m[2], status: 'confirmed' });
    if (init.method === 'POST') { const e = { ...JSON.parse(init.body), id: 'novo' + criados.length, hangoutLink: 'https://meet.google.com/xyz', _cal: cal, _q: u.search }; criados.push(e); return r(e); }
    return r({ items: [...(G[cal] || []), ...(mostrarCriados ? criados.filter(e => e._cal === cal) : [])] });
  }
  throw new Error('fetch inesperado: ' + url);
};
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sr', GOOGLE_CLIENT_ID: 'cid', GOOGLE_CLIENT_SECRET: 'sec' })[k] }, serve: h => globalThis.__h = h };

const src = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/crm-agendar/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__db;');
await import('data:text/javascript,' + encodeURIComponent(src));
const chamar = async (corpo, ip = '1.1.1.1') => { const r = await globalThis.__h(new Request('https://x/functions/v1/crm-agendar', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://rovyacreative.com.br', 'x-forwarded-for': ip }, body: JSON.stringify(corpo) })); return { status: r.status, cors: r.headers.get('Access-Control-Allow-Origin'), ...(await r.json()) }; };

// 1) horários livres
let h = await chamar({ acao: 'horarios' });
ok(h.cors === 'https://rovyacreative.com.br', 'responde só para o site (CORS)');
ok(JSON.stringify(h.horarios) === JSON.stringify([{ inicio: BR(3, '14:00'), fim: BR(3, '15:00') }]), `só as 14h sobram (15h bate com o pessoal, 16h com um compromisso; livre e recusado não bloqueiam; hoje cedo fica fora) → ${h.horarios.map(x => x.inicio).join(', ')}`);
ok(!JSON.stringify(h).includes('Pilates') && Object.keys(h.horarios[0]).join() === 'inicio,fim', 'não devolve nada da agenda, só início e fim');

// 2) validações
ok((await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Robô', email: 'r@b.com', site: 'http://spam' })).ok && T.crm_agendamentos.length === 0, 'campo escondido preenchido (robô): finge que deu certo e não grava');
ok((await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Ana', email: 'ana@' })).status === 400, 'e-mail inválido é recusado');
ok((await chamar({ acao: 'reservar', inicio: BR(3, '15:00'), nome: 'Ana', email: 'ana@exemplo.com' })).status === 409, 'horário que não está livre é recusado');

// 3) reservar
let r = await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Ana Lima', email: 'ana@exemplo.com', telefone: '61 9', empresa: 'Lima Doces', mensagem: 'Quero reposicionar a marca' });
ok(r.ok && r.meet === 'https://meet.google.com/xyz', 'reserva confirmada, com link do Meet');
const e = criados[0];
ok(e._cal === 'prof' && /conferenceDataVersion=1/.test(e._q) && /sendUpdates=all/.test(e._q), 'reunião criada na agenda profissional, com Meet e convite enviado');
ok(JSON.stringify(e.attendees) === JSON.stringify([{ email: 'ana@exemplo.com', displayName: 'Ana Lima' }]) && e.summary === 'Primeira conversa · Ana Lima (Lima Doces)', 'a pessoa é convidada e o título diz quem é');
ok(e.extendedProperties.private.crm_cliente === 'c1' && T.crm_clientes.length === 1, 'achou a cliente que já existia pelo e-mail (sem diferenciar maiúsculas)');
ok(T.crm_agendamentos[0].evento_id === 'novo0' && T.crm_agendamentos[0].cliente_id === 'c1', 'agendamento guardado com o evento e a cliente');
ok(T.crm_interacoes.length === 1 && T.crm_interacoes[0].resumo.includes('reposicionar') && T.crm_oportunidades.length === 1 && T.crm_oportunidades[0].etapa === 'contato', 'histórico e oportunidade no funil criados');
ok(avisos.length === 1 && avisos[0].cron === 'k' && avisos[0].aviso.corpo.startsWith('Ana Lima (Lima Doces)'), 'Sabrina recebe o aviso no celular');
h = await chamar({ acao: 'horarios' });
ok(h.horarios.length === 0, 'depois de marcado, o horário some da lista');

// 4) corrida: dois ao mesmo tempo (o Google ainda não mostra o evento do primeiro)
mostrarCriados = false;
r = await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Bia', email: 'bia@exemplo.com' }, '2.2.2.2');
ok(r.status === 409 && /preenchido/.test(r.erro) && criados.length === 1, 'segunda pessoa no mesmo horário é recusada (trava no banco)');
eventoApagado = true; // Sabrina apagou a reunião da Ana no Google: o horário volta a valer
r = await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Bia', email: 'bia@exemplo.com' }, '2.2.2.2');
ok(r.ok && T.crm_agendamentos.filter(a => a.status === 'confirmado').length === 1 && T.crm_agendamentos.some(a => a.status === 'cancelado'), 'se a reunião anterior foi apagada, libera e marca a nova');
ok(T.crm_clientes.some(c => c.email === 'bia@exemplo.com' && c.origem === 'Agenda do site'), 'pessoa nova vira cliente com origem “Agenda do site”');

// 5) limites
for (const ip of ['3.3.3.3', '3.3.3.3', '3.3.3.3']) T.crm_agendamentos.push({ id: 'x' + ++n, inicio: 'x' + n, status: 'cancelado', ip, email: 'z@z.com', criado_em: new Date().toISOString() });
eventoApagado = false; mostrarCriados = true;
r = await chamar({ acao: 'reservar', inicio: BR(3, '14:00'), nome: 'Zé', email: 'ze@exemplo.com' }, '3.3.3.3');
ok(r.status === 429, 'mais de 3 tentativas do mesmo lugar no dia são barradas');
const semGoogle = T.crm_google.splice(0);
ok(JSON.stringify((await chamar({ acao: 'horarios' })).horarios) === '[]', 'Google desconectado: lista vazia (a página manda para o Instagram)');
T.crm_google.push(...semGoogle);

console.log('ERROS:', erros.length ? erros : 'nenhum');
process.exit(erros.length ? 1 : 0);
