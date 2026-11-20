// Backup semanal (crm-google) no Node com Drive e banco de mentira:
// sem a estrutura do Drive, cria só a raiz e a "15" e salva o backup lá; com a 15 pronta, usa ela.
// Também confere que 'token' entrega o que a janela de escolher pasta (Picker) precisa.
//   node testes/teste_backup_funcao.mjs
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const erros = [];
const ok = (c, m) => { console.log((c ? 'OK   ' : 'FALHA') + ' ' + m); if (!c) erros.push(m); };

const T = {
  crm_google: [{ id: 1, refresh_token: 'rt', email: 'rovya@x' }], crm_config: [{ chave: 'cron_key', valor: 'k' }], crm_falhas: [],
  crm_drive: [{ chave: '15', folder_id: null, nome: '15 — Tecnologia e Sistemas' }], crm_clientes: [{ id: 'c1', nome: 'Ana' }], admins: [{ email: 'a@x' }],
};
class Q {
  constructor(t) { this.t = t; this.f = []; this.op = 'select'; }
  select() { return this; }
  insert(v) { this.op = 'insert'; this.v = v; return this; }
  update(v) { this.op = 'update'; this.v = v; return this; }
  upsert(v) { this.op = 'upsert'; this.v = v; return this; }
  eq(k, v) { this.f.push(r => r[k] === v); return this; }
  in(k, l) { this.f.push(r => l.includes(r[k])); return this; }
  order() { return this; }
  range() { return this; }
  maybeSingle() { this.um = true; return this; }
  then(res) {
    const t = T[this.t] ||= [], casa = r => this.f.every(f => f(r));
    if (this.op === 'select') { const rs = t.filter(casa); return res({ data: this.um ? rs[0] ?? null : rs, error: null }); }
    if (this.op === 'insert') { t.push(...[].concat(this.v)); return res({ error: null }); }
    if (this.op === 'update') { t.filter(casa).forEach(r => Object.assign(r, this.v)); return res({ error: null }); }
    if (this.op === 'upsert') { for (const r of [].concat(this.v)) { const x = t.find(y => y.chave === r.chave); x ? Object.assign(x, r) : t.push({ ...r }); } return res({ error: null }); }
  }
}
globalThis.__db = { from: t => new Q(t), auth: { getUser: async () => ({ data: { user: { email: 'a@x', factors: [] } } }) } };

let pastas = [], envios = [], n = 0;
globalThis.fetch = async (url, o = {}) => {
  url = String(url); const J = (x, h = {}) => new Response(JSON.stringify(x), { headers: h });
  if (url.startsWith('https://oauth2.googleapis.com/tokeninfo')) return J({ scope: 'https://www.googleapis.com/auth/drive.file' });
  if (url.startsWith('https://oauth2.googleapis.com/token')) return J({ access_token: 'at', expires_in: 3600 });
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?fields=id')) { const b = JSON.parse(o.body); const id = 'p' + ++n; pastas.push({ id, ...b }); return J({ id }); }
  if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files')) { envios.push(JSON.parse(o.body)); return J({}, { Location: 'https://up/1' }); }
  if (url === 'https://up/1') return J({ id: 'f1', name: 'b.json' });
  if (url.startsWith('https://www.googleapis.com/drive/v3/files?')) return J({ files: [] });
  return J({});
};
globalThis.Deno = { env: { get: k => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sr', GOOGLE_CLIENT_ID: '123456789-abc.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'sec' })[k] }, serve: h => globalThis.__h = h };
const src = stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/crm-google/index.ts', import.meta.url), 'utf8'))
  .replace(/import \{ createClient \} from 'jsr:@supabase\/supabase-js@2';/, 'const createClient = () => globalThis.__db;');
await import('data:text/javascript,' + encodeURIComponent(src));
const chamar = (corpo, h = {}) => globalThis.__h(new Request('https://x/functions/v1/crm-google', { method: 'POST', headers: { 'Content-Type': 'application/json', ...h }, body: JSON.stringify(corpo) })).then(r => r.json());

// 1) sem estrutura: cria raiz + 15 e salva lá
let r = await chamar({ backup: true }, { 'x-cron': 'k' });
ok(r.ok === true, 'backup feito sem ninguém ter criado a estrutura: ' + JSON.stringify(r));
ok(pastas.length === 2 && pastas[0].name === 'ROVYA — GESTÃO EMPRESARIAL' && !pastas[0].parents && pastas[1].name === '15 — Tecnologia e Sistemas' && pastas[1].parents[0] === 'p1',
  'cria só a raiz e a “15 — Tecnologia e Sistemas” dentro dela');
ok(envios[0]?.parents[0] === 'p2', 'o arquivo do backup vai para a 15');
ok(T.crm_drive.find(x => x.chave === 'raiz')?.folder_id === 'p1' && T.crm_drive.find(x => x.chave === '15')?.folder_id === 'p2', 'guarda as duas pastas (o “Criar estrutura” aproveita depois)');
ok(!T.crm_falhas.some(f => !f.resolvida && f.origem === 'backup'), 'sem aviso de falha');
// 2) semana seguinte: usa a 15 que já existe, não cria pasta
r = await chamar({ backup: true }, { 'x-cron': 'k' });
ok(r.ok === true && pastas.length === 2 && envios[1]?.parents[0] === 'p2', 'na semana seguinte usa a mesma pasta');
// 3) token: sem chave do Picker → picker null; com chave → chave + número do projeto
const tk = h => chamar({ acao: 'token' }, { Authorization: 'Bearer h.' + Buffer.from('{"aal":"aal1"}').toString('base64') + '.s' });
r = await tk(); ok(r.token === 'at' && r.drive === true && r.picker === null, 'token sem chave do Picker: picker vazio ' + JSON.stringify(r));
T.crm_config.push({ chave: 'google_picker_key', valor: 'AIzaX' });
r = await tk(); ok(r.picker?.chave === 'AIzaX' && r.picker?.app === '123456789', 'token com chave: entrega a chave e o número do projeto: ' + JSON.stringify(r.picker));

console.log('ERROS:', erros.length ? erros : 'nenhum'); process.exit(erros.length ? 1 : 0);
