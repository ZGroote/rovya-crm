// Google Drive: estrutura da ROVYA, pasta de cada cliente e envio de arquivos.
// Escopo drive.file: o CRM só enxerga o que ele mesmo criou. Tudo acontece por clique (Manual Mestre).
import { sb, $, main, esc, hoje, dataBR, toast, q, formulario, funcao } from './util.js';

export const AREAS = [['00', 'Central de Controle'], ['01', 'Direção e Estratégia'], ['02', 'Administrativo e Jurídico'], ['03', 'Financeiro e Contabilidade'],
  ['04', 'Comercial e Prospecção'], ['05', 'Propostas e Negociações'], ['06', 'Contratos e Documentação'], ['07', 'Clientes e Onboarding'],
  ['08', 'Catálogo de Serviços'], ['09', 'Projetos e Operações'], ['10', 'Produção e Criação'], ['11', 'Marketing ROVYA'],
  ['12', 'Identidade Visual e Branding'], ['13', 'Processos e Procedimentos'], ['14', 'Relatórios e Inteligência'], ['15', 'Tecnologia e Sistemas'],
  ['16', 'Biblioteca e Recursos'], ['17', 'Arquivo e Histórico']];
export const SUBPASTAS = [['01', 'Cadastro'], ['02', 'Diagnóstico'], ['03', 'Propostas e Contratos'], ['04', 'Estratégia'], ['05', 'Branding'], ['06', 'Conteúdo'],
  ['07', 'Projetos'], ['08', 'Aprovações'], ['09', 'Entregas'], ['10', 'Relatórios'], ['11', 'Reuniões'], ['12', 'Histórico']];
const RAIZ = 'ROVYA — GESTÃO EMPRESARIAL';
const PASTA = 'application/vnd.google-apps.folder';

// MAIÚSCULAS, sem acento, palavras unidas por _ (nomes de pasta e arquivo do manual)
export const slug = t => (t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').toUpperCase();
export const pastaLink = id => `https://drive.google.com/drive/folders/${id}`;

let cache = null; // { token, ate }
async function token() {
  if (cache && Date.now() < cache.ate) return cache.token;
  const r = await funcao('crm-google', 'token');
  if (r.conectado === false) throw new Error('Google não conectado. Vá em Agenda → Conectar.');
  if (!r.drive) throw new Error('Falta autorizar o Drive: em Agenda, desconecte e conecte o Google de novo.');
  cache = { token: r.token, ate: Date.now() + 50 * 6e4 };
  return r.token;
}
async function api(url, init = {}) {
  const r = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + await token(), ...init.headers } });
  if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error('Drive: ' + (j.error?.message || r.status)); }
  return r;
}
async function criarPasta(nome, pai) {
  const r = await api('https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nome, mimeType: PASTA, parents: pai ? [pai] : undefined }) });
  return (await r.json()).id;
}
// a pasta ainda existe e não está na lixeira? (se ela apagou no Drive, recriamos)
async function existe(id) {
  try { return !(await (await api(`https://www.googleapis.com/drive/v3/files/${id}?fields=trashed`)).json()).trashed; } catch { return false; }
}

// estrutura-mãe: raiz + 18 áreas. Cria só o que falta; devolve {chave: folder_id}.
export async function garantirEstrutura() {
  const ids = Object.fromEntries((await q(sb.from('crm_drive').select('chave,folder_id'))).map(x => [x.chave, x.folder_id]));
  if (ids.raiz && !await existe(ids.raiz)) { await q(sb.from('crm_drive').delete().neq('chave', '')); for (const k in ids) delete ids[k]; }
  const novas = [];
  if (!ids.raiz) { ids.raiz = await criarPasta(RAIZ); novas.push({ chave: 'raiz', folder_id: ids.raiz, nome: RAIZ }); }
  for (const [k, n] of AREAS) if (!ids[k]) {
    const nome = `${k} — ${n}`; ids[k] = await criarPasta(nome, ids.raiz); novas.push({ chave: k, folder_id: ids[k], nome });
  }
  if (novas.length) await q(sb.from('crm_drive').upsert(novas));
  return ids;
}

// pasta CLIENTE_[CODIGO]_[NOME] dentro de "07 — Clientes e Onboarding", com as subpastas escolhidas
export async function criarPastaCliente(c) {
  const marcadas = await escolherSubpastas(c, Object.keys(c.drive_subpastas || {}));
  if (!marcadas) return null;
  toast('Criando pastas no Drive…');
  const codigo = c.codigo || await q(sb.rpc('crm_dar_codigo', { p_cliente: c.id }));
  const ids = await garantirEstrutura();
  let pasta = c.drive_pasta && await existe(c.drive_pasta) ? c.drive_pasta : null;
  const subs = pasta ? { ...(c.drive_subpastas || {}) } : {};
  if (!pasta) pasta = await criarPasta(`CLIENTE_${codigo}_${slug(c.empresa || c.nome)}`, ids['07']);
  for (const [k, n] of SUBPASTAS) if (marcadas.includes(k) && !subs[k]) subs[k] = await criarPasta(`${k} ${n}`, pasta);
  await q(sb.from('crm_clientes').update({ drive_pasta: pasta, drive_subpastas: subs }).eq('id', c.id));
  Object.assign(c, { codigo, drive_pasta: pasta, drive_subpastas: subs });
  toast('Pasta do cliente pronta no Drive'); return pasta;
}
// o manual pede só as subpastas pertinentes ao escopo contratado
function escolherSubpastas(c, ja) {
  const padrao = ja.length ? ja : ['01', '02', '03', '11', '12'];
  const caixas = `<fieldset style="border:0;padding:0;margin:0;display:grid;grid-template-columns:1fr 1fr;gap:6px 14px">${SUBPASTAS.map(([k, n]) =>
    `<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0;font-size:.92rem;color:var(--ink)"><input type="checkbox" data-sub="${k}" ${padrao.includes(k) ? 'checked' : ''} ${ja.includes(k) ? 'disabled' : ''}> ${k} ${n}</label>`).join('')}</fieldset>`;
  const p = formulario(`Pasta no Drive · ${c.empresa || c.nome}`, [], {}, `<p class="mute" style="margin:0">Marque só as subpastas que o escopo contratado precisa. Dá para acrescentar outras depois.</p>${caixas}`, 'Criar no Drive');
  // o conteúdo do diálogo continua no DOM depois de fechar
  return p.then(ok => ok ? [...$('#dlgf').querySelectorAll('[data-sub]:checked')].map(i => i.dataset.sub) : null);
}

// envia um arquivo para a subpasta do cliente com o nome padrão ROVYA_[CLIENTE]_[TIPO]_[AAAA-MM-DD]_V01.ext
// vinculo: { projeto_id?, proposta_id?, contrato_id? }; versao opcional (senão, conta os do mesmo tipo)
export async function enviarAoDrive({ cliente, arquivo, tipo, subpasta, versao, vinculo = {}, classificacao = 'interno' }) {
  if (!cliente.drive_pasta) throw new Error('Crie primeiro a pasta do cliente no Drive (ficha do cliente).');
  tipo = slug(tipo) || 'DOCUMENTO';
  let pai = cliente.drive_subpastas?.[subpasta];
  if (!pai) { // subpasta ainda não criada: cria agora, porque ela pediu o envio para lá
    const nome = SUBPASTAS.find(s => s[0] === subpasta);
    if (!nome) throw new Error('Subpasta inválida');
    pai = await criarPasta(`${nome[0]} ${nome[1]}`, cliente.drive_pasta);
    cliente.drive_subpastas = { ...(cliente.drive_subpastas || {}), [subpasta]: pai };
    await q(sb.from('crm_clientes').update({ drive_subpastas: cliente.drive_subpastas }).eq('id', cliente.id));
  }
  if (!versao) {
    const { count } = await sb.from('crm_documentos').select('id', { count: 'exact', head: true }).eq('cliente_id', cliente.id).eq('tipo', tipo);
    versao = (count || 0) + 1;
  }
  const ext = (arquivo.name.match(/\.[\w]+$/) || [''])[0].toLowerCase();
  const nome = `ROVYA_${cliente.codigo || slug(cliente.empresa || cliente.nome)}_${tipo}_${hoje()}_V${String(versao).padStart(2, '0')}${ext}`;
  toast('Enviando ' + nome + '…');
  // upload resumível: funciona para arquivos grandes (vídeos, PDFs pesados)
  const ini = await api('https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,webViewLink', {
    method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': arquivo.type || 'application/octet-stream' },
    body: JSON.stringify({ name: nome, parents: [pai] }) });
  const destino = ini.headers.get('Location');
  if (!destino) throw new Error('O Drive não devolveu o endereço de envio.');
  const f = await (await fetch(destino, { method: 'PUT', body: arquivo })).json();
  if (!f.id) throw new Error('Drive: ' + (f.error?.message || 'falha no envio'));
  const [doc] = await q(sb.from('crm_documentos').insert({ drive_id: f.id, nome: f.name, link: f.webViewLink, tipo, subpasta, versao, classificacao,
    cliente_id: cliente.id, tamanho: arquivo.size, ...vinculo }).select());
  toast('Salvo no Drive: ' + f.name); return doc;
}

// diálogo genérico de envio (ficha do cliente)
export async function dialogoEnviar(cliente, vinculo = {}, padrao = {}) {
  const v = await formulario('Enviar ao Drive', [
    { k: 'tipo', l: 'Tipo (vira parte do nome: BRIEFING, ARTE, RELATORIO…)', req: true },
    { k: 'subpasta', l: 'Subpasta', t: 'select', o: SUBPASTAS.map(([k, n]) => [k, `${k} ${n}${cliente.drive_subpastas?.[k] ? '' : ' (será criada)'}`]), meia: true },
    { k: 'classificacao', l: 'Classificação', t: 'select', o: [['interno', 'Interno'], ['cliente', 'Pode ir ao cliente'], ['confidencial', 'Confidencial']], meia: true }],
    { subpasta: '01', classificacao: 'interno', ...padrao }, '<label>Arquivo<input type="file" id="arqDrive" required></label>', 'Enviar');
  const arq = $('#arqDrive')?.files[0];
  if (!v || !arq) return null;
  return enviarAoDrive({ cliente, arquivo: arq, ...v, vinculo });
}

// lista de documentos (ficha do cliente e tela Documentos)
export const linhaDoc = d => `<li><a class="cresce" href="${esc(d.link || '#')}" target="_blank" rel="noopener"><b>${esc(d.nome)}</b><small>${esc(d.tipo)} · v${d.versao}${d.subpasta ? ' · pasta ' + esc(d.subpasta) : ''}${d.crm_clientes ? ' · ' + esc(d.crm_clientes.empresa || d.crm_clientes.nome) : ''}</small></a><span class="pill">${esc(d.classificacao)}</span><span class="mute">${dataBR(d.criado_em.slice(0, 10))}</span></li>`;

// cartão da ficha do cliente
export async function cartaoDrive(c) {
  const docs = await q(sb.from('crm_documentos').select('*').eq('cliente_id', c.id).order('criado_em', { ascending: false }).limit(12));
  return `<section class="card" id="cartaoDrive"><h3>Drive</h3>${c.drive_pasta
    ? `<p style="margin:4px 0 10px"><a href="${pastaLink(c.drive_pasta)}" target="_blank" rel="noopener">Abrir pasta CLIENTE_${esc(c.codigo || '')} →</a></p>
       <ul class="lista">${docs.map(linhaDoc).join('') || '<li class="vazio">Nenhum arquivo enviado pelo CRM ainda.</li>'}</ul>
       <div class="acoes" style="margin-top:8px"><button class="bt peq" data-drive="enviar">Enviar arquivo</button><button class="bt peq fantasma" data-drive="pasta">Subpastas</button></div>`
    : `<p class="mute">Este cliente ainda não tem pasta no Drive.</p><button class="bt peq sec" data-drive="pasta">Criar pasta no Drive</button>`}</section>`;
}
export function ligarCartaoDrive(c, recarregar) {
  main.querySelectorAll('[data-drive]').forEach(b => b.onclick = async () => {
    try { if (b.dataset.drive === 'pasta' ? await criarPastaCliente(c) : await dialogoEnviar(c)) recarregar(); }
    catch (e) { toast(e.message, true); }
  });
}

// rota #/documentos: estrutura do Drive + últimos documentos
export async function documentos() {
  const [areas, docs] = await Promise.all([
    q(sb.from('crm_drive').select('*').order('chave')),
    q(sb.from('crm_documentos').select('*,crm_clientes(nome,empresa)').order('criado_em', { ascending: false }).limit(60))]);
  const raiz = areas.find(a => a.chave === 'raiz');
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Google Drive</div><h1>Documentos</h1><p>O Drive guarda os arquivos; o CRM guarda onde cada um está.</p></div>
    <div class="acoes">${raiz ? `<a class="bt sec" href="${pastaLink(raiz.folder_id)}" target="_blank" rel="noopener">Abrir no Drive</a>` : ''}<button class="bt" id="estr">${raiz ? 'Conferir estrutura' : 'Criar estrutura no Drive'}</button></div></div>
    <div class="grade2">
      <section class="card"><h3>Últimos arquivos</h3><ul class="lista">${docs.map(linhaDoc).join('') || '<li class="vazio">Nenhum arquivo ainda. Envie pela ficha do cliente, pela proposta ou pelo contrato.</li>'}</ul></section>
      <section class="card"><h3>Estrutura</h3><ul class="lista">${AREAS.map(([k, n]) => { const a = areas.find(x => x.chave === k);
        return `<li>${a ? `<a class="cresce" href="${pastaLink(a.folder_id)}" target="_blank" rel="noopener">${k} — ${esc(n)}</a>` : `<span class="cresce mute">${k} — ${esc(n)}</span>`}</li>`; }).join('')}</ul></section>
    </div>`;
  $('#estr').onclick = async () => {
    try { toast('Conferindo o Drive…'); await garantirEstrutura(); toast('Estrutura pronta'); documentos(); } catch (e) { toast(e.message, true); }
  };
}
