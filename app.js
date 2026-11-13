import { sb, SUPABASE_URL } from './config.js';

/* ---------- utilidades ---------- */
const $ = s => document.querySelector(s);
const main = $('#main');
const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const diaLocal = (mais = 0) => new Date(Date.now() + mais * 864e5).toLocaleDateString('sv'); // AAAA-MM-DD no fuso local
const hoje = () => diaLocal();
const dataBR = d => d ? new Date(d + (d.length === 10 ? 'T12:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
const venceu = d => d && d < hoje();

function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (erro ? ' erro' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3200);
}
async function q(p) { const { data, error } = await p; if (error) { toast(error.message, true); throw error; } return data; }

const ETAPAS_FUNIL = [['contato', 'Primeiro contato'], ['diagnostico', 'Diagnóstico'], ['proposta', 'Proposta enviada'], ['negociacao', 'Negociação'], ['ganho', 'Fechado'], ['perdido', 'Perdido']];
const STATUS_ENT = [['a_fazer', 'A fazer'], ['produzindo', 'Em produção'], ['enviado', 'Enviado'], ['revisao', 'Em revisão'], ['aprovado', 'Aprovado']];
const STATUS_PROJ = [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['concluido', 'Concluído']];
const TIPOS_MODELO = [['orientacao', 'Orientação de etapa'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['contrato', 'Contrato'], ['termo', 'Termo'], ['outro', 'Outro']];
const rotulo = (lista, v) => (lista.find(x => x[0] === v) || [, v])[1];

// preenche {{empresa}}, {{contato}}, {{cliente}} com os dados do cliente
const preencher = (txt, c) => (txt || '')
  .replaceAll('{{empresa}}', c?.empresa || c?.nome || '{{empresa}}')
  .replaceAll('{{contato}}', (c?.nome || '{{contato}}').split(' ')[0])
  .replaceAll('{{cliente}}', c?.nome || '{{cliente}}');

// textos vindos do Trello usam markdown simples (## título, **negrito**)
const mdHtml = t => esc(t).replace(/^#{1,6}\s*(.+)$/gm, '<b class="tit">$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
const mdTexto = t => (t || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '*$1*'); // *negrito* do WhatsApp

/* ---------- formulário genérico em <dialog> ---------- */
// campos: [{k, l, t:'text'|'textarea'|'date'|'time'|'number'|'email'|'select', o:[[v,l]], req, full}]
function formulario(titulo, campos, val = {}, extra = '', botao = 'Salvar') {
  const dlg = $('#dlg'), f = $('#dlgf');
  const campo = c => {
    const v = val[c.k] ?? c.padrao ?? '';
    const at = `name="${c.k}" ${c.req ? 'required' : ''}`;
    const input = c.t === 'textarea' ? `<textarea ${at} rows="${c.linhas || 5}">${esc(v)}</textarea>`
      : c.t === 'select' ? `<select ${at}>${c.o.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`
      : `<input type="${c.t || 'text'}" ${at} value="${esc(v)}" ${c.t === 'number' ? 'step="0.01" min="0"' : ''}>`;
    return `<label>${esc(c.l)}${input}</label>`;
  };
  const html = []; for (let i = 0; i < campos.length; i++) {
    const c = campos[i], d = campos[i + 1];
    if (c.meia && d?.meia) { html.push(`<div class="dupla">${campo(c)}${campo(d)}</div>`); i++; } else html.push(campo(c));
  }
  f.innerHTML = `<h2>${esc(titulo)}</h2>${html.join('')}${extra}
    <div class="rodape"><button class="bt fantasma" value="cancelar" formnovalidate>Cancelar</button><button class="bt" value="ok">${botao}</button></div>`;
  dlg.showModal(); f.querySelector('input,textarea,select')?.focus();
  return new Promise(res => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return res(null);
      const o = {}; for (const c of campos) { let v = f.elements[c.k].value.trim(); o[c.k] = v === '' ? null : (c.t === 'number' ? Number(v) : v); }
      res(o);
    };
  });
}
const confirma = async msg => (await formulario(msg, [], {}, '', 'Confirmar')) !== null;

/* ---------- autenticação ---------- */
const { data: { session } } = await sb.auth.getSession();
if (!session) location.replace('login.html');
$('#sair').onclick = async () => { await sb.auth.signOut(); location.replace('login.html'); };

/* ---------- roteador ---------- */
const rotas = { '': inicio, funil, clientes, cliente, projetos, projeto, financeiro, agenda, modelos, assistente };
async function rotear() {
  const [r, id] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = rotas[r] || inicio;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (r || 'inicio') || (a.dataset.r + 's') === r || (r === 'cliente' && a.dataset.r === 'clientes') || (r === 'projeto' && a.dataset.r === 'projetos')));
  main.innerHTML = '<p class="vazio">Carregando…</p>';
  try { await fn(id); } catch (e) { console.error(e); main.innerHTML = `<p class="vazio">Não consegui carregar: ${esc(e.message)}</p>`; }
  main.focus({ preventScroll: true });
}
addEventListener('hashchange', rotear);

/* ---------- dados compartilhados ---------- */
const listaClientes = () => q(sb.from('crm_clientes').select('id,nome,empresa').order('nome'));
const opcoesClientes = cs => cs.map(c => [c.id, c.nome + (c.empresa ? ` · ${c.empresa}` : '')]);
const CAMPOS_CLIENTE = [
  { k: 'nome', l: 'Nome do contato', req: true }, { k: 'empresa', l: 'Empresa / marca' },
  { k: 'email', l: 'E-mail', t: 'email', meia: true }, { k: 'telefone', l: 'WhatsApp', meia: true },
  { k: 'instagram', l: 'Instagram', meia: true }, { k: 'origem', l: 'Como chegou (indicação, Instagram…)', meia: true },
  { k: 'notas', l: 'Notas', t: 'textarea', linhas: 3 }];

async function novoCliente() {
  const v = await formulario('Novo cliente', CAMPOS_CLIENTE); if (!v) return null;
  const [c] = await q(sb.from('crm_clientes').insert(v).select()); toast('Cliente cadastrado'); return c;
}

/* ---------- INÍCIO ---------- */
async function inicio() {
  const em7 = diaLocal(7);
  const [ops, ents, parc, projs] = await Promise.all([
    q(sb.from('crm_oportunidades').select('id,titulo,proximo_passo,proximo_em,etapa,crm_clientes(nome)').not('etapa', 'in', '(ganho,perdido)').not('proximo_em', 'is', null).lte('proximo_em', em7).order('proximo_em')),
    q(sb.from('crm_entregas').select('id,titulo,prazo,status,crm_etapas!inner(projeto_id,crm_projetos!inner(nome,status))').neq('status', 'aprovado').eq('crm_etapas.crm_projetos.status', 'ativo').not('prazo', 'is', null).lte('prazo', em7).order('prazo')),
    q(sb.from('crm_parcelas').select('id,descricao,valor,vencimento,crm_projetos(nome)').is('pago_em', null).lte('vencimento', em7).order('vencimento')),
    q(sb.from('crm_projetos').select('id,nome,crm_clientes(nome),crm_etapas(crm_entregas(status))').eq('status', 'ativo').order('criado_em', { ascending: false })),
  ]);
  const h = new Date().getHours(), saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const progresso = p => { const es = p.crm_etapas.flatMap(e => e.crm_entregas); return es.length ? Math.round(100 * es.filter(e => e.status === 'aprovado').length / es.length) : 0; };
  main.innerHTML = `
  <div class="topo"><div><div class="eyebrow">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>${saud}, Sabrina</h1></div>
    <div class="acoes"><button class="bt sec" id="nOp">+ Oportunidade</button><button class="bt" id="nCli">+ Cliente</button></div></div>
  <div class="grade2">
    <section class="card"><h3>Próximos passos</h3><ul class="lista">${ops.map(o => `<li><div class="cresce"><b>${esc(o.proximo_passo || o.titulo)}</b><small>${esc(o.crm_clientes?.nome)} · ${esc(rotulo(ETAPAS_FUNIL, o.etapa))}</small></div><span class="${venceu(o.proximo_em) ? 'atrasado' : 'mute'}">${dataBR(o.proximo_em)}</span></li>`).join('') || '<li class="vazio">Nada para esta semana.</li>'}</ul><p><a href="#/funil" class="mute">Ver funil →</a></p></section>
    <section class="card"><h3>Entregas com prazo</h3><ul class="lista">${ents.map(e => `<li><div class="cresce"><b>${esc(e.titulo)}</b><small>${esc(e.crm_etapas.crm_projetos.nome)}</small></div><span class="pill p-${e.status}">${rotulo(STATUS_ENT, e.status)}</span><span class="${venceu(e.prazo) ? 'atrasado' : 'mute'}">${dataBR(e.prazo)}</span></li>`).join('') || '<li class="vazio">Nenhum prazo nos próximos 7 dias.</li>'}</ul></section>
    <section class="card"><h3>A receber</h3><ul class="lista">${parc.map(p => `<li><div class="cresce"><b>${brl(p.valor)}</b><small>${esc(p.crm_projetos?.nome)}${p.descricao ? ' · ' + esc(p.descricao) : ''}</small></div><span class="${venceu(p.vencimento) ? 'atrasado' : 'mute'}">${venceu(p.vencimento) ? 'atrasada · ' : ''}${dataBR(p.vencimento)}</span></li>`).join('') || '<li class="vazio">Nenhuma parcela vencendo.</li>'}</ul><p><a href="#/financeiro" class="mute">Ver financeiro →</a></p></section>
    <section class="card" id="agHoje"><h3>Agenda de hoje</h3><p class="vazio">Carregando…</p></section>
  </div>
  <h2 style="margin:28px 0 12px">Projetos ativos</h2>
  <div class="grade">${projs.map(p => `<a class="card linkcard" href="#/projeto/${p.id}"><b>${esc(p.nome)}</b><p class="mute" style="margin:2px 0 12px">${esc(p.crm_clientes?.nome)}</p><div class="barra"><i style="width:${progresso(p)}%"></i></div><small class="mute">${progresso(p)}% aprovado</small></a>`).join('') || '<p class="vazio">Nenhum projeto ativo.</p>'}</div>`;
  $('#nCli').onclick = async () => { const c = await novoCliente(); if (c) location.hash = '#/cliente/' + c.id; };
  $('#nOp').onclick = async () => { if (await novaOportunidade()) location.hash = '#/funil'; };
  // agenda de hoje (não bloqueia a tela)
  google('listar', { de: new Date(hoje() + 'T00:00').toISOString(), ate: new Date(hoje() + 'T23:59:59').toISOString() }).then(r => {
    const el = $('#agHoje'); if (!el) return;
    el.innerHTML = `<h3>Agenda de hoje</h3>` + (r.conectado === false ? `<p class="vazio">Google Agenda não conectado. <a href="#/agenda">Conectar</a></p>`
      : `<ul class="lista">${r.eventos.map(e => `<li><span class="mute" style="min-width:48px">${horaEv(e)}</span><div class="cresce"><b>${esc(e.summary || '(sem título)')}</b></div></li>`).join('') || '<li class="vazio">Dia livre.</li>'}</ul>`);
  }).catch(() => { const el = $('#agHoje'); if (el) el.innerHTML = '<h3>Agenda de hoje</h3><p class="vazio">Agenda indisponível.</p>'; });
}

/* ---------- FUNIL ---------- */
async function novaOportunidade(clienteId) {
  const cs = await listaClientes();
  const v = await formulario('Nova oportunidade', [
    { k: 'cliente_id', l: 'Cliente', t: 'select', o: [['', 'Selecione…'], ...opcoesClientes(cs), ['+', '+ Cadastrar novo cliente']], req: true },
    { k: 'titulo', l: 'O que ela precisa', req: true },
    { k: 'valor', l: 'Valor estimado (R$)', t: 'number', meia: true }, { k: 'etapa', l: 'Etapa', t: 'select', o: ETAPAS_FUNIL.slice(0, 4), meia: true },
    { k: 'proximo_passo', l: 'Próximo passo' }, { k: 'proximo_em', l: 'Quando', t: 'date' },
    { k: 'notas', l: 'Notas', t: 'textarea', linhas: 3 }], { cliente_id: clienteId || '' });
  if (!v) return null;
  if (v.cliente_id === '+') { const c = await novoCliente(); if (!c) return null; v.cliente_id = c.id; }
  const [o] = await q(sb.from('crm_oportunidades').insert(v).select()); toast('Oportunidade criada'); return o;
}
async function editarOportunidade(o) {
  const v = await formulario(o.titulo, [
    { k: 'titulo', l: 'O que ela precisa', req: true },
    { k: 'valor', l: 'Valor estimado (R$)', t: 'number', meia: true }, { k: 'etapa', l: 'Etapa', t: 'select', o: ETAPAS_FUNIL, meia: true },
    { k: 'proximo_passo', l: 'Próximo passo' }, { k: 'proximo_em', l: 'Quando', t: 'date' },
    { k: 'motivo_perda', l: 'Se perdido: motivo' }, { k: 'notas', l: 'Notas', t: 'textarea', linhas: 4 }], o,
    `<p><a href="#/cliente/${o.cliente_id}" onclick="document.getElementById('dlg').close()">Abrir ficha do cliente →</a></p>`);
  if (!v) return;
  await moverOportunidade(o, v.etapa, v);
}
async function moverOportunidade(o, etapa, extra = {}) {
  await q(sb.from('crm_oportunidades').update({ ...extra, etapa, atualizado_em: new Date().toISOString() }).eq('id', o.id));
  if (etapa === 'ganho' && o.etapa !== 'ganho') {
    const proj = await q(sb.from('crm_projetos').select('id').eq('oportunidade_id', o.id));
    if (!proj.length) await criarProjeto(o.cliente_id, o.titulo, o.id, o.valor);
  }
}
async function funil() {
  const ops = await q(sb.from('crm_oportunidades').select('*,crm_clientes(nome,empresa)').order('ordem'));
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Funil</h1><p>Arraste os cartões entre as colunas. Ao chegar em “Fechado”, o projeto é criado a partir do seu modelo.</p></div>
    <button class="bt" id="nOp">+ Oportunidade</button></div>
    <div class="funil">${ETAPAS_FUNIL.map(([k, l]) => {
      const lst = ops.filter(o => o.etapa === k), tot = lst.reduce((s, o) => s + (Number(o.valor) || 0), 0);
      return `<section class="col" data-etapa="${k}"><header><b>${l}</b><span>${lst.length}${tot ? ' · ' + brl(tot) : ''}</span></header>
      ${lst.map(o => `<article class="op" draggable="true" data-id="${o.id}"><b>${esc(o.crm_clientes?.empresa || o.crm_clientes?.nome)}</b><small>${esc(o.titulo)}</small>
        ${o.valor ? `<span class="valor">${brl(o.valor)}</span>` : ''}${o.proximo_passo && !['ganho', 'perdido'].includes(k) ? `<small class="${venceu(o.proximo_em) ? 'atrasado' : ''}">→ ${esc(o.proximo_passo)} ${dataBR(o.proximo_em)}</small>` : ''}</article>`).join('')}</section>`;
    }).join('')}</div>`;
  $('#nOp').onclick = async () => { if (await novaOportunidade()) funil(); };
  const porId = Object.fromEntries(ops.map(o => [o.id, o]));
  main.querySelectorAll('.op').forEach(el => {
    el.onclick = async () => { await editarOportunidade(porId[el.dataset.id]); funil(); };
    el.ondragstart = e => e.dataTransfer.setData('text/plain', el.dataset.id);
  });
  main.querySelectorAll('.col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('sobre'); };
    col.ondragleave = () => col.classList.remove('sobre');
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('sobre');
      const o = porId[e.dataTransfer.getData('text/plain')]; if (!o || o.etapa === col.dataset.etapa) return;
      await moverOportunidade(o, col.dataset.etapa, { ordem: Date.now() / 1000 }); funil();
    };
  });
}

/* ---------- CLIENTES ---------- */
async function clientes() {
  const cs = await q(sb.from('crm_clientes').select('*,crm_projetos(status),crm_oportunidades(etapa)').order('nome'));
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Relacionamento</div><h1>Clientes</h1></div>
    <div class="acoes"><input class="busca" id="busca" placeholder="Buscar por nome, empresa, e-mail…" type="search"><button class="bt" id="nCli">+ Cliente</button></div></div>
    <div class="card"><table><thead><tr><th>Cliente</th><th class="esconde-cel">Contato</th><th>Situação</th></tr></thead><tbody id="tb"></tbody></table></div>`;
  const sit = c => c.crm_projetos.some(p => p.status === 'ativo') ? '<span class="pill p-aprovado">Projeto ativo</span>'
    : c.crm_oportunidades.some(o => !['ganho', 'perdido'].includes(o.etapa)) ? '<span class="pill p-produzindo">Em negociação</span>'
    : c.crm_projetos.length ? '<span class="pill">Ex-cliente</span>' : '<span class="pill">Contato</span>';
  const desenha = f => $('#tb').innerHTML = cs.filter(c => !f || [c.nome, c.empresa, c.email, c.instagram].join(' ').toLowerCase().includes(f))
    .map(c => `<tr style="cursor:pointer" data-id="${c.id}"><td><b>${esc(c.nome)}</b><br><small class="mute">${esc(c.empresa)}</small></td><td class="esconde-cel"><small>${esc(c.email)}<br>${esc(c.telefone)}</small></td><td>${sit(c)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="vazio">Nenhum cliente ainda.</td></tr>';
  desenha();
  $('#busca').oninput = e => desenha(e.target.value.toLowerCase().trim());
  $('#tb').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/cliente/' + tr.dataset.id; };
  $('#nCli').onclick = async () => { const c = await novoCliente(); if (c) location.hash = '#/cliente/' + c.id; };
}
async function cliente(id) {
  const [c] = await q(sb.from('crm_clientes').select('*,crm_oportunidades(*),crm_projetos(id,nome,status,valor)').eq('id', id));
  if (!c) { main.innerHTML = '<p class="vazio">Cliente não encontrado.</p>'; return; }
  const zap = c.telefone ? 'https://wa.me/' + c.telefone.replace(/\D/g, '').replace(/^(?!55)/, '55') : null;
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/clientes">Clientes</a></div><h1>${esc(c.nome)}</h1><p>${esc(c.empresa)}</p></div>
    <div class="acoes">${zap ? `<a class="bt sec" href="${zap}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${c.email ? `<a class="bt sec" href="mailto:${esc(c.email)}">E-mail</a>` : ''}
    <button class="bt sec" id="agendar">Agendar reunião</button><button class="bt sec" id="ed">Editar</button><button class="bt" id="nOp">+ Oportunidade</button></div></div>
  <div class="grade2">
    <section class="card"><h3>Dados</h3><ul class="lista">
      ${[['E-mail', c.email], ['WhatsApp', c.telefone], ['Instagram', c.instagram], ['Origem', c.origem], ['Cliente desde', dataBR(c.criado_em.slice(0, 10))]].filter(x => x[1]).map(([l, v]) => `<li><span class="mute" style="min-width:110px">${l}</span><span>${esc(v)}</span></li>`).join('')}</ul>
      ${c.notas ? `<p style="white-space:pre-wrap">${esc(c.notas)}</p>` : ''}</section>
    <section class="card"><h3>Projetos</h3><ul class="lista">${c.crm_projetos.map(p => `<li><a class="cresce" href="#/projeto/${p.id}"><b>${esc(p.nome)}</b></a><span class="pill">${rotulo(STATUS_PROJ, p.status)}</span></li>`).join('') || '<li class="vazio">Nenhum projeto.</li>'}</ul>
      <button class="bt peq sec" id="nProj">+ Projeto</button></section>
    <section class="card"><h3>Oportunidades</h3><ul class="lista">${c.crm_oportunidades.map(o => `<li data-op="${o.id}" style="cursor:pointer"><div class="cresce"><b>${esc(o.titulo)}</b><small>${o.valor ? brl(o.valor) + ' · ' : ''}${esc(o.proximo_passo || '')}</small></div><span class="pill">${rotulo(ETAPAS_FUNIL, o.etapa)}</span></li>`).join('') || '<li class="vazio">Nenhuma oportunidade.</li>'}</ul></section>
  </div>`;
  $('#ed').onclick = async () => {
    const v = await formulario('Editar cliente', CAMPOS_CLIENTE, c, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar cliente</button>');
    if ($('#dlg').returnValue === 'apagar') { if (await confirma(`Apagar ${c.nome} e tudo ligado a ele?`)) { await q(sb.from('crm_clientes').delete().eq('id', id)); location.hash = '#/clientes'; } return; }
    if (v) { await q(sb.from('crm_clientes').update(v).eq('id', id)); toast('Salvo'); cliente(id); }
  };
  $('#nOp').onclick = async () => { if (await novaOportunidade(id)) cliente(id); };
  $('#nProj').onclick = async () => { await criarProjeto(id, c.empresa || c.nome); };
  $('#agendar').onclick = () => novoEvento({ cliente_id: id, titulo: 'Reunião · ' + (c.empresa || c.nome) }).then(ok => ok && toast('Reunião agendada no Google Agenda'));
  main.querySelectorAll('[data-op]').forEach(li => li.onclick = async () => { await editarOportunidade(c.crm_oportunidades.find(o => o.id === li.dataset.op)); cliente(id); });
}

/* ---------- PROJETOS ---------- */
async function criarProjeto(clienteId, nome, oportunidadeId = null, valor = null) {
  const mods = await q(sb.from('crm_modelos').select('id,titulo').eq('tipo', 'projeto').order('criado_em'));
  const v = await formulario('Novo projeto', [
    { k: 'nome', l: 'Nome do projeto', req: true },
    { k: 'modelo', l: 'Começar a partir de', t: 'select', o: [...mods.map(m => [m.id, m.titulo]), ['', 'Projeto em branco']] },
    { k: 'valor', l: 'Valor do contrato (R$)', t: 'number', meia: true }, { k: 'entrega_prevista', l: 'Entrega prevista', t: 'date', meia: true }],
    { nome, valor, modelo: mods[0]?.id ?? '' });
  if (!v) return;
  const pid = await q(sb.rpc('crm_projeto_de_modelo', { p_cliente: clienteId, p_nome: v.nome, p_modelo: v.modelo, p_oportunidade: oportunidadeId }));
  await q(sb.from('crm_projetos').update({ valor: v.valor, entrega_prevista: v.entrega_prevista }).eq('id', pid));
  toast('Projeto criado'); location.hash = '#/projeto/' + pid;
}
async function projetos() {
  const ps = await q(sb.from('crm_projetos').select('*,crm_clientes(nome,empresa),crm_etapas(crm_entregas(status))').order('criado_em', { ascending: false }));
  const prog = p => { const es = p.crm_etapas.flatMap(e => e.crm_entregas); return es.length ? Math.round(100 * es.filter(e => e.status === 'aprovado').length / es.length) : 0; };
  const grupo = st => ps.filter(p => p.status === st).map(p => `<a class="card linkcard" href="#/projeto/${p.id}"><b>${esc(p.nome)}</b><p class="mute" style="margin:2px 0 12px">${esc(p.crm_clientes?.empresa || p.crm_clientes?.nome)}${p.entrega_prevista ? ' · entrega ' + dataBR(p.entrega_prevista) : ''}</p><div class="barra"><i style="width:${prog(p)}%"></i></div><small class="mute">${prog(p)}% aprovado</small></a>`).join('');
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Produção</div><h1>Projetos</h1></div><button class="bt" id="nProj">+ Projeto</button></div>
    ${STATUS_PROJ.map(([k, l]) => { const g = grupo(k); return g ? `<h2 style="margin:8px 0 12px">${l}</h2><div class="grade" style="margin-bottom:26px">${g}</div>` : ''; }).join('') || '<p class="vazio">Nenhum projeto ainda. Projetos nascem quando uma oportunidade é fechada no funil, ou pelo botão acima.</p>'}`;
  $('#nProj').onclick = async () => {
    const cs = await listaClientes(); if (!cs.length) { toast('Cadastre um cliente primeiro'); return; }
    const v = await formulario('Para qual cliente?', [{ k: 'c', l: 'Cliente', t: 'select', o: opcoesClientes(cs) }]); if (!v) return;
    const c = cs.find(x => x.id === v.c); await criarProjeto(c.id, c.empresa || c.nome);
  };
}
async function projeto(id, aba = 'etapas') {
  const [p] = await q(sb.from('crm_projetos').select('*,crm_clientes(*),crm_etapas(*,crm_entregas(*,crm_anexos(id))),crm_parcelas(*)').eq('id', id));
  if (!p) { main.innerHTML = '<p class="vazio">Projeto não encontrado.</p>'; return; }
  p.crm_etapas.sort((a, b) => a.ordem - b.ordem); p.crm_etapas.forEach(e => e.crm_entregas.sort((a, b) => a.ordem - b.ordem));
  const es = p.crm_etapas.flatMap(e => e.crm_entregas), ok = es.filter(e => e.status === 'aprovado').length, pct = es.length ? Math.round(100 * ok / es.length) : 0;
  const c = p.crm_clientes, recebido = p.crm_parcelas.filter(x => x.pago_em).reduce((s, x) => s + +x.valor, 0);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/cliente/${c.id}">${esc(c.empresa || c.nome)}</a></div><h1>${esc(p.nome)}</h1>
      <p>${ok} de ${es.length} entregas aprovadas${p.entrega_prevista ? ' · entrega prevista ' + dataBR(p.entrega_prevista) : ''}</p></div>
    <div class="acoes"><select id="st" class="busca" style="min-width:0">${STATUS_PROJ.map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="bt sec" id="ed">Editar</button></div></div>
    <div class="barra" style="margin-bottom:20px"><i style="width:${pct}%"></i></div>
    <div class="tabs"><button data-a="etapas">Etapas e entregas</button><button data-a="financeiro">Financeiro · ${brl(recebido)} de ${brl(p.valor)}</button></div>
    <div id="aba"></div>`;
  main.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.a === aba); b.onclick = () => projeto(id, b.dataset.a); });
  $('#st').onchange = async e => { await q(sb.from('crm_projetos').update({ status: e.target.value }).eq('id', id)); toast('Status atualizado'); };
  $('#ed').onclick = async () => {
    const v = await formulario('Editar projeto', [{ k: 'nome', l: 'Nome', req: true }, { k: 'valor', l: 'Valor do contrato (R$)', t: 'number', meia: true }, { k: 'entrega_prevista', l: 'Entrega prevista', t: 'date', meia: true }], p,
      `<div class="acoes"><button class="bt fantasma" value="modelo" formnovalidate>Salvar estrutura como modelo</button><button class="bt fantasma" value="apagar" formnovalidate style="color:var(--bad)">Apagar projeto</button></div>`);
    const rv = $('#dlg').returnValue;
    if (rv === 'apagar') { if (await confirma(`Apagar o projeto “${p.nome}”?`)) { await q(sb.from('crm_projetos').delete().eq('id', id)); location.hash = '#/projetos'; } return; }
    if (rv === 'modelo') return salvarComoModelo(p);
    if (v) { await q(sb.from('crm_projetos').update(v).eq('id', id)); projeto(id, aba); }
  };
  const alvo = $('#aba');
  if (aba === 'financeiro') return abaFinanceiro(p, alvo);
  alvo.innerHTML = p.crm_etapas.map((e, i) => `<section class="card etapa" data-etapa="${e.id}">
      <header><div><div class="n">ETAPA ${String(i + 1).padStart(2, '0')}</div><h3>${esc(e.titulo)}</h3></div>
        <div class="acoes"><button class="bt peq fantasma" data-ed-etapa="${e.id}">Editar etapa</button><button class="bt peq sec" data-nova-ent="${e.id}">+ Entrega</button></div></header>
      ${e.orientacao ? `<details class="ori"><summary>Orientação para o cliente</summary><div class="txt">${mdHtml(preencher(e.orientacao, c))}</div><button class="bt peq sec" data-copiar="${e.id}">Copiar texto</button></details>` : ''}
      ${e.crm_entregas.map(x => `<div class="ent" data-ent="${x.id}">
        <span class="mute" title="${x.crm_anexos.length} arquivo(s)">${x.crm_anexos.length ? '📎' : ''}</span>
        <span class="t">${esc(x.titulo)}${x.prazo ? ` <small class="${venceu(x.prazo) && x.status !== 'aprovado' ? 'atrasado' : ''}">· ${dataBR(x.prazo)}</small>` : ''}</span>
        <select class="stt" data-status="${x.id}">${STATUS_ENT.map(([k, l]) => `<option value="${k}" ${k === x.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="bt peq fantasma" data-abrir="${x.id}">Abrir</button></div>`).join('') || '<p class="vazio">Nenhuma entrega nesta etapa.</p>'}
    </section>`).join('') + `<button class="bt sec" id="nEtapa">+ Etapa</button>`;
  const porEnt = Object.fromEntries(es.map(x => [x.id, x])), porEtapa = Object.fromEntries(p.crm_etapas.map(e => [e.id, e]));
  alvo.querySelectorAll('[data-status]').forEach(s => s.onchange = async () => {
    await q(sb.from('crm_entregas').update({ status: s.value, atualizado_em: new Date().toISOString() }).eq('id', s.dataset.status)); toast(rotulo(STATUS_ENT, s.value)); projeto(id, aba);
  });
  alvo.querySelectorAll('[data-abrir],.ent .t').forEach(b => b.onclick = () => abrirEntrega(porEnt[b.dataset.abrir || b.closest('[data-ent]').dataset.ent], p).then(() => projeto(id, aba)));
  alvo.querySelectorAll('[data-copiar]').forEach(b => b.onclick = () => { navigator.clipboard.writeText(mdTexto(preencher(porEtapa[b.dataset.copiar].orientacao, c))); toast('Texto copiado'); });
  alvo.querySelectorAll('[data-nova-ent]').forEach(b => b.onclick = async () => {
    const v = await formulario('Nova entrega', [{ k: 'titulo', l: 'Entrega', req: true }, { k: 'prazo', l: 'Prazo', t: 'date' }]); if (!v) return;
    await q(sb.from('crm_entregas').insert({ ...v, etapa_id: b.dataset.novaEnt, ordem: porEtapa[b.dataset.novaEnt].crm_entregas.length + 1 })); projeto(id, aba);
  });
  alvo.querySelectorAll('[data-ed-etapa]').forEach(b => b.onclick = async () => {
    const e = porEtapa[b.dataset.edEtapa];
    const v = await formulario('Editar etapa', [{ k: 'titulo', l: 'Título', req: true }, { k: 'orientacao', l: 'Orientação (use {{empresa}} e {{contato}})', t: 'textarea', linhas: 10 }], e,
      '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar etapa</button>');
    if ($('#dlg').returnValue === 'apagar') { if (await confirma(`Apagar a etapa “${e.titulo}” e suas entregas?`)) { await q(sb.from('crm_etapas').delete().eq('id', e.id)); projeto(id, aba); } return; }
    if (v) { await q(sb.from('crm_etapas').update(v).eq('id', e.id)); projeto(id, aba); }
  });
  $('#nEtapa').onclick = async () => {
    const v = await formulario('Nova etapa', [{ k: 'titulo', l: 'Título', req: true }, { k: 'orientacao', l: 'Orientação para o cliente', t: 'textarea', linhas: 8 }]); if (!v) return;
    await q(sb.from('crm_etapas').insert({ ...v, projeto_id: id, ordem: p.crm_etapas.length + 1 })); projeto(id, aba);
  };
}
async function abrirEntrega(x, p) {
  const anexos = await q(sb.from('crm_anexos').select('*').eq('entrega_id', x.id).order('criado_em'));
  const links = await Promise.all(anexos.map(async a => { const { data } = await sb.storage.from('crm-anexos').createSignedUrl(a.caminho, 3600); return { ...a, url: data?.signedUrl }; }));
  const extra = `<div><label>Anexos</label><div class="anexos">${links.map(a => `<span><a href="${esc(a.url)}" target="_blank" rel="noopener">${esc(a.nome)}</a> <small class="mute">${((a.tamanho || 0) / 1048576).toFixed(1)} MB</small> <button type="button" class="bt peq fantasma" data-del-anexo="${a.id}">remover</button></span>`).join('') || '<span class="vazio">Nenhum arquivo.</span>'}
    <input type="file" id="arq" multiple></div></div>
    <button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar entrega</button>`;
  const pr = formulario(x.titulo, [
    { k: 'titulo', l: 'Entrega', req: true },
    { k: 'status', l: 'Status', t: 'select', o: STATUS_ENT, meia: true }, { k: 'prazo', l: 'Prazo', t: 'date', meia: true },
    { k: 'texto', l: 'Texto de entrega para o cliente', t: 'textarea', linhas: 9 },
    { k: 'link', l: 'Link (Canva, Heyzine, Drive…)' }], { ...x, texto: x.texto ?? `${(p.crm_clientes.nome || '').split(' ')[0]}, ` }, extra);
  $('#dlgf').querySelectorAll('[data-del-anexo]').forEach(b => b.onclick = async () => {
    const a = anexos.find(z => z.id === b.dataset.delAnexo);
    await q(sb.storage.from('crm-anexos').remove([a.caminho])); await q(sb.from('crm_anexos').delete().eq('id', a.id)); b.parentElement.remove(); toast('Arquivo removido');
  });
  const arquivos = $('#arq');
  const v = await pr;
  if ($('#dlg').returnValue === 'apagar') { if (await confirma(`Apagar a entrega “${x.titulo}”?`)) await q(sb.from('crm_entregas').delete().eq('id', x.id)); return; }
  if (!v) return;
  await q(sb.from('crm_entregas').update({ ...v, atualizado_em: new Date().toISOString() }).eq('id', x.id));
  for (const f of arquivos.files) {
    const caminho = `${p.id}/${x.id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
    toast('Enviando ' + f.name + '…');
    await q(sb.storage.from('crm-anexos').upload(caminho, f));
    await q(sb.from('crm_anexos').insert({ entrega_id: x.id, nome: f.name, caminho, tamanho: f.size }));
  }
  toast('Entrega salva');
}
async function salvarComoModelo(p) {
  const v = await formulario('Salvar como modelo', [{ k: 'titulo', l: 'Nome do modelo', req: true }], { titulo: p.nome });
  if (!v) return;
  const tirar = t => (t || '').replaceAll(p.crm_clientes.empresa || '\u0000', '{{empresa}}').replaceAll((p.crm_clientes.nome || '\u0000').split(' ')[0], '{{contato}}');
  const estrutura = p.crm_etapas.map(e => ({ titulo: e.titulo, orientacao: tirar(e.orientacao), entregas: e.crm_entregas.map(x => x.titulo) }));
  await q(sb.from('crm_modelos').insert({ tipo: 'projeto', titulo: v.titulo, estrutura })); toast('Modelo salvo');
}

/* ---------- FINANCEIRO ---------- */
const CAMPOS_PARCELA = [{ k: 'descricao', l: 'Descrição (ex.: entrada, 2ª parcela)' }, { k: 'valor', l: 'Valor (R$)', t: 'number', req: true, meia: true }, { k: 'vencimento', l: 'Vencimento', t: 'date', meia: true },
  { k: 'forma', l: 'Forma (Pix, boleto…)', meia: true }, { k: 'pago_em', l: 'Pago em (vazio = em aberto)', t: 'date', meia: true }];
function linhaParcela(x, comProjeto) {
  const st = x.pago_em ? `<span class="pill p-aprovado">Pago ${dataBR(x.pago_em)}</span>` : venceu(x.vencimento) ? '<span class="pill p-revisao">Atrasada</span>' : '<span class="pill">Em aberto</span>';
  return `<tr data-parc="${x.id}" style="cursor:pointer"><td>${dataBR(x.vencimento)}</td><td>${comProjeto ? `<b>${esc(x.crm_projetos?.nome)}</b><br><small class="mute">${esc(x.descricao)}</small>` : esc(x.descricao)}</td><td class="dir">${brl(x.valor)}</td><td>${st}</td>
    <td class="dir">${x.pago_em ? '' : `<button class="bt peq sec" data-pagar="${x.id}">Recebi</button>`}</td></tr>`;
}
function ligarParcelas(el, lista, depois) {
  el.querySelectorAll('[data-pagar]').forEach(b => b.onclick = async ev => { ev.stopPropagation(); await q(sb.from('crm_parcelas').update({ pago_em: hoje() }).eq('id', b.dataset.pagar)); toast('Pagamento registrado'); depois(); });
  el.querySelectorAll('[data-parc]').forEach(tr => tr.onclick = async () => {
    const x = lista.find(z => z.id === tr.dataset.parc);
    const v = await formulario('Parcela', CAMPOS_PARCELA, x, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar parcela</button>');
    if ($('#dlg').returnValue === 'apagar') { await q(sb.from('crm_parcelas').delete().eq('id', x.id)); return depois(); }
    if (v) { await q(sb.from('crm_parcelas').update(v).eq('id', x.id)); depois(); }
  });
}
function abaFinanceiro(p, el) {
  const ps = p.crm_parcelas.sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const total = ps.reduce((s, x) => s + +x.valor, 0), pago = ps.filter(x => x.pago_em).reduce((s, x) => s + +x.valor, 0);
  el.innerHTML = `<div class="grade" style="margin-bottom:16px">
      <div class="card kpi"><div class="rot">Contrato</div><div class="num">${brl(p.valor)}</div></div>
      <div class="card kpi"><div class="rot">Recebido</div><div class="num">${brl(pago)}</div></div>
      <div class="card kpi"><div class="rot">Em aberto</div><div class="num">${brl(total - pago)}</div>${p.valor && Math.abs(total - p.valor) > .01 ? `<small class="atrasado">Parcelas somam ${brl(total)}</small>` : ''}</div></div>
    <div class="card"><div class="acoes" style="justify-content:flex-end;margin-bottom:8px"><button class="bt peq sec" id="dividir">Dividir em parcelas</button><button class="bt peq" id="nParc">+ Parcela</button></div>
    <table><thead><tr><th>Vence</th><th>Descrição</th><th class="dir">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${ps.map(x => linhaParcela(x)).join('') || '<tr><td colspan="5" class="vazio">Nenhuma parcela lançada.</td></tr>'}</tbody></table></div>`;
  const recarregar = () => projeto(p.id, 'financeiro');
  ligarParcelas(el, ps, recarregar);
  $('#nParc').onclick = async () => { const v = await formulario('Nova parcela', CAMPOS_PARCELA); if (v) { await q(sb.from('crm_parcelas').insert({ ...v, projeto_id: p.id })); recarregar(); } };
  $('#dividir').onclick = async () => {
    const v = await formulario('Dividir em parcelas', [{ k: 'valor', l: 'Valor total (R$)', t: 'number', req: true, meia: true }, { k: 'n', l: 'Parcelas', t: 'number', req: true, meia: true }, { k: 'inicio', l: '1º vencimento', t: 'date', req: true, meia: true }, { k: 'forma', l: 'Forma', meia: true }], { valor: p.valor || '', n: 2, inicio: hoje() });
    if (!v) return;
    const n = Math.max(1, Math.round(v.n)), base = Math.floor(v.valor * 100 / n) / 100, [a, m, d] = v.inicio.split('-').map(Number);
    const linhas = Array.from({ length: n }, (_, i) => ({ projeto_id: p.id, descricao: `${i + 1}/${n}`, forma: v.forma,
      valor: i === n - 1 ? Math.round((v.valor - base * (n - 1)) * 100) / 100 : base,
      vencimento: new Date(Date.UTC(a, m - 1 + i, Math.min(d, 28))).toISOString().slice(0, 10) }));
    await q(sb.from('crm_parcelas').insert(linhas));
    if (!p.valor) await q(sb.from('crm_projetos').update({ valor: v.valor }).eq('id', p.id)); // contrato vazio: assume o total
    toast(`${n} parcelas lançadas`); recarregar();
  };
}
async function financeiro(filtro = 'abertas') {
  const ps = await q(sb.from('crm_parcelas').select('*,crm_projetos(id,nome)').order('vencimento'));
  const mes = hoje().slice(0, 7), em30 = diaLocal(30);
  const soma = l => l.reduce((s, x) => s + +x.valor, 0);
  const recMes = soma(ps.filter(x => x.pago_em?.startsWith(mes))), atras = ps.filter(x => !x.pago_em && venceu(x.vencimento)), prox = ps.filter(x => !x.pago_em && !venceu(x.vencimento) && x.vencimento <= em30);
  const filtros = { abertas: x => !x.pago_em, atrasadas: x => !x.pago_em && venceu(x.vencimento), pagas: x => x.pago_em, todas: () => true };
  // recebido por mês, últimos 6 meses
  const meses = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + i); return d.toLocaleDateString('sv').slice(0, 7); });
  const porMes = meses.map(m => soma(ps.filter(x => x.pago_em?.startsWith(m)))), max = Math.max(...porMes, 1);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Dinheiro</div><h1>Financeiro</h1></div></div>
    <div class="grade" style="margin-bottom:18px">
      <div class="card kpi"><div class="rot">Recebido este mês</div><div class="num">${brl(recMes)}</div></div>
      <div class="card kpi"><div class="rot">A receber em 30 dias</div><div class="num">${brl(soma(prox))}</div><small class="mute">${prox.length} parcela(s)</small></div>
      <div class="card kpi"><div class="rot">Atrasado</div><div class="num ${atras.length ? 'atrasado' : ''}">${brl(soma(atras))}</div><small class="mute">${atras.length} parcela(s)</small></div>
      <div class="card kpi"><div class="rot">Recebido · 6 meses</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:64px;margin-top:8px">${porMes.map((v, i) => `<div title="${meses[i]}: ${brl(v)}" style="flex:1;display:grid;gap:3px;justify-items:center"><div style="width:100%;height:${Math.max(2, 52 * v / max)}px;background:${i === 5 ? 'var(--wine)' : '#c9a06388'};border-radius:3px 3px 0 0"></div><small class="mute" style="font-size:.62rem">${new Date(meses[i] + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></div>`).join('')}</div></div></div>
    <div class="tabs">${Object.keys(filtros).map(f => `<button data-f="${f}" class="${f === filtro ? 'on' : ''}">${f[0].toUpperCase() + f.slice(1)}</button>`).join('')}</div>
    <div class="card"><table><thead><tr><th>Vence</th><th>Projeto</th><th class="dir">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${ps.filter(filtros[filtro]).map(x => linhaParcela(x, true)).join('') || '<tr><td colspan="5" class="vazio">Nada aqui.</td></tr>'}</tbody></table></div>
    <p class="mute">As parcelas são lançadas dentro de cada projeto, na aba Financeiro.</p>`;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => financeiro(b.dataset.f));
  ligarParcelas(main, ps, () => financeiro(filtro));
}

/* ---------- MODELOS ---------- */
async function modelos() {
  const ms = await q(sb.from('crm_modelos').select('*').order('tipo').order('titulo'));
  const proj = ms.filter(m => m.tipo === 'projeto'), txt = ms.filter(m => m.tipo !== 'projeto');
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Biblioteca</div><h1>Modelos</h1><p>Use {{empresa}}, {{contato}} e {{cliente}}: são trocados pelos dados do cliente na hora de usar.</p></div><button class="bt" id="nMod">+ Modelo de texto</button></div>
    <h2 style="margin-bottom:12px">Modelos de projeto</h2>
    <div class="grade" style="margin-bottom:28px">${proj.map(m => `<article class="card"><b>${esc(m.titulo)}</b><p class="mute" style="margin:4px 0 10px">${esc(m.corpo || '')}</p>
      <ol style="margin:0;padding-left:20px">${(m.estrutura || []).map(e => `<li>${esc(e.titulo)} <small class="mute">· ${(e.entregas || []).length} entregas</small></li>`).join('')}</ol>
      <div class="acoes" style="margin-top:10px"><button class="bt peq fantasma" data-del="${m.id}">Apagar</button></div></article>`).join('') || '<p class="vazio">Nenhum. Em um projeto, use Editar → “Salvar estrutura como modelo”.</p>'}</div>
    <h2 style="margin-bottom:12px">Textos e documentos</h2>
    ${TIPOS_MODELO.map(([k, l]) => { const g = txt.filter(m => m.tipo === k); return g.length ? `<h3 style="margin:14px 0 8px">${l}</h3><div class="grade">${g.map(m => `<article class="card"><b>${esc(m.titulo)}</b><p class="mute" style="margin:6px 0 10px;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${esc(m.corpo)}</p>
      <div class="acoes"><button class="bt peq" data-usar="${m.id}">Usar</button><button class="bt peq sec" data-ed="${m.id}">Editar</button></div></article>`).join('')}</div>` : ''; }).join('') || '<p class="vazio">Nenhum modelo de texto ainda. Cadastre seus e-mails, mensagens de WhatsApp, cláusulas e termos.</p>'}`;
  const porId = Object.fromEntries(ms.map(m => [m.id, m]));
  const CAMPOS = [{ k: 'titulo', l: 'Título', req: true }, { k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS_MODELO }, { k: 'corpo', l: 'Texto', t: 'textarea', linhas: 12 }];
  $('#nMod').onclick = async () => { const v = await formulario('Novo modelo', CAMPOS); if (v) { await q(sb.from('crm_modelos').insert(v)); modelos(); } };
  main.querySelectorAll('[data-ed]').forEach(b => b.onclick = async () => {
    const v = await formulario('Editar modelo', CAMPOS, porId[b.dataset.ed], '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar</button>');
    if ($('#dlg').returnValue === 'apagar') { await q(sb.from('crm_modelos').delete().eq('id', b.dataset.ed)); return modelos(); }
    if (v) { await q(sb.from('crm_modelos').update(v).eq('id', b.dataset.ed)); modelos(); }
  });
  main.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { if (await confirma(`Apagar o modelo “${porId[b.dataset.del].titulo}”?`)) { await q(sb.from('crm_modelos').delete().eq('id', b.dataset.del)); modelos(); } });
  main.querySelectorAll('[data-usar]').forEach(b => b.onclick = async () => {
    const cs = await listaClientes(); if (!cs.length) { toast('Cadastre um cliente primeiro'); return; }
    const v = await formulario('Para qual cliente?', [{ k: 'c', l: 'Cliente', t: 'select', o: opcoesClientes(cs) }]); if (!v) return;
    const [c] = await q(sb.from('crm_clientes').select('*').eq('id', v.c));
    const texto = preencher(porId[b.dataset.usar].corpo, c);
    await formulario(porId[b.dataset.usar].titulo, [{ k: 't', l: 'Texto pronto (pode ajustar antes de copiar)', t: 'textarea', linhas: 14 }], { t: texto }, '<button type="button" class="bt sec" id="copiar">Copiar</button>', 'Fechar');
  });
}
document.addEventListener('click', e => { if (e.target.id === 'copiar') { navigator.clipboard.writeText($('#dlgf').elements.t.value); toast('Copiado'); } });

/* ---------- AGENDA (Google, pela Edge Function crm-google) ---------- */
async function funcao(nome, acao, dados = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, { method: 'POST', headers: { Authorization: 'Bearer ' + session.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, ...dados }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erro || 'Falha (' + r.status + ')'); return j;
}
const google = (acao, dados) => funcao('crm-google', acao, dados);
const horaEv = e => e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'dia todo';
async function novoEvento(val = {}, ev = null) {
  const cs = await listaClientes();
  const v = await formulario(ev ? 'Editar compromisso' : 'Novo compromisso', [
    { k: 'titulo', l: 'Título', req: true }, { k: 'cliente_id', l: 'Cliente (opcional)', t: 'select', o: [['', '—'], ...opcoesClientes(cs)] },
    { k: 'data', l: 'Data', t: 'date', req: true, meia: true }, { k: 'hora', l: 'Início', t: 'time', req: true, meia: true },
    { k: 'duracao', l: 'Duração (min)', t: 'number', meia: true }, { k: 'local', l: 'Local ou link', meia: true }, { k: 'notas', l: 'Notas', t: 'textarea', linhas: 3 }],
    { data: hoje(), hora: '10:00', duracao: 60, ...val }, ev ? '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar compromisso</button>' : '');
  if ($('#dlg').returnValue === 'apagar') { if (await confirma('Apagar do Google Agenda também?')) { await google('apagar', { id: ev.id }); toast('Apagado'); return true; } return false; }
  if (!v) return false;
  const ini = new Date(`${v.data}T${v.hora}`), fim = new Date(ini.getTime() + (v.duracao || 60) * 6e4);
  const evento = { summary: v.titulo, location: v.local || undefined, description: v.notas || undefined, start: { dateTime: ini.toISOString() }, end: { dateTime: fim.toISOString() },
    extendedProperties: { private: { crm_cliente: v.cliente_id || '' } } };
  try { await google(ev ? 'editar' : 'criar', { id: ev?.id, evento }); } catch (e) { toast(e.message, true); return false; }
  return true;
}
async function agenda() {
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Google Agenda</div><h1>Agenda</h1><p id="agSub">Carregando…</p></div><div class="acoes" id="agAcoes"></div></div><div id="agLista"></div>`;
  const de = new Date(); de.setHours(0, 0, 0, 0); const ate = new Date(de.getTime() + 21 * 864e5);
  let r; try { r = await google('listar', { de: de.toISOString(), ate: ate.toISOString() }); }
  catch (e) { $('#agSub').textContent = e.message; return; }
  if (r.conectado === false) {
    $('#agSub').textContent = 'Conecte a conta Google da Rovya para ver e criar compromissos daqui.';
    $('#agAcoes').innerHTML = '<button class="bt" id="con">Conectar Google Agenda</button>';
    $('#con').onclick = async () => { const { url } = await google('url', { volta: location.href.split('#')[0] + '#/agenda' }); location.href = url; };
    return;
  }
  const cs = Object.fromEntries((await listaClientes()).map(c => [c.id, c]));
  $('#agSub').textContent = `Conectada a ${r.email} · próximas 3 semanas`;
  $('#agAcoes').innerHTML = '<button class="bt sec" id="desc">Desconectar</button><button class="bt" id="nEv">+ Compromisso</button>';
  const dias = {}; for (const e of r.eventos) { const d = (e.start.dateTime || e.start.date).slice(0, 10); (dias[d] ||= []).push(e); }
  const dia = d => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#agLista').innerHTML = Object.entries(dias).map(([d, evs]) => `<section class="dia"><h3>${d === hoje() ? 'Hoje · ' : ''}${dia(d)}</h3>${evs.map(e => {
    const cid = e.extendedProperties?.private?.crm_cliente, c = cs[cid];
    return `<div class="ev ${c ? 'crm' : ''}" data-ev="${e.id}"><span class="h">${horaEv(e)}</span><div><b>${esc(e.summary || '(sem título)')}</b>${c ? `<br><small class="mute">${esc(c.nome)}</small>` : ''}${e.location ? `<br><small class="mute">${esc(e.location)}</small>` : ''}</div></div>`;
  }).join('')}</section>`).join('') || '<p class="vazio">Nenhum compromisso nas próximas 3 semanas.</p>';
  const porId = Object.fromEntries(r.eventos.map(e => [e.id, e]));
  main.querySelectorAll('[data-ev]').forEach(el => el.onclick = async () => {
    const e = porId[el.dataset.ev]; if (!e.start.dateTime) { window.open(e.htmlLink, '_blank'); return; }
    const ini = new Date(e.start.dateTime), fim = new Date(e.end.dateTime);
    const ok = await novoEvento({ titulo: e.summary, cliente_id: e.extendedProperties?.private?.crm_cliente || '', data: ini.toLocaleDateString('sv'), hora: ini.toTimeString().slice(0, 5), duracao: Math.round((fim - ini) / 6e4), local: e.location, notas: e.description }, e);
    if (ok) agenda();
  });
  $('#nEv').onclick = async () => { if (await novoEvento()) { toast('Criado no Google Agenda'); agenda(); } };
  $('#desc').onclick = async () => { if (await confirma('Desconectar o Google Agenda?')) { await google('desconectar'); agenda(); } };
}

/* ---------- ASSISTENTE (IA + notificações, pela Edge Function crm-assistente) ---------- */
const PEDIDO_RESUMO = 'Bom dia! Me dá o resumo de hoje?';
const chaveChat = () => 'rovya-chat-' + hoje();
const lerChat = () => { try { return JSON.parse(localStorage.getItem(chaveChat())) || []; } catch { return []; } };
const gravarChat = m => { try { localStorage.setItem(chaveChat(), JSON.stringify(m.slice(-40))); } catch { } };
// negrito e listas simples nas respostas da IA
const fmtIA = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>').replace(/\n/g, '<br>');

async function assistente() {
  let msgs = lerChat();
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Sua assistente</div><h1>Assistente</h1><p>Pergunte sobre clientes, projetos, prazos, agenda e dinheiro.</p></div>
    <div class="acoes" id="avisos"></div></div>
    <section class="chat card"><div class="msgs" id="msgs"></div>
      <form class="enviar" id="fChat"><textarea id="pergunta" rows="1" placeholder="Pergunte algo… (ex.: o que falta na Conecta?)"></textarea><button class="bt" id="bEnviar">Enviar</button></form>
      <div class="sugestoes">${['O que é prioridade hoje?', 'Quanto tenho a receber este mês?', 'Quem está sem resposta há mais tempo?', 'Como está cada projeto?'].map(s => `<button type="button" class="bt peq sec">${s}</button>`).join('')}</div>
    </section>`;
  const caixa = $('#msgs');
  const desenhar = (pensando) => {
    caixa.innerHTML = msgs.filter(m => !m.oculta).map(m => `<div class="msg ${m.role === 'user' ? 'eu' : 'ia'}">${m.role === 'user' ? esc(m.content) : fmtIA(m.content)}</div>`).join('')
      + (pensando ? '<div class="msg ia pensando"><i></i><i></i><i></i></div>' : '');
    caixa.scrollTop = caixa.scrollHeight;
  };
  const perguntar = async texto => {
    if (texto) msgs.push({ role: 'user', content: texto });
    $('#bEnviar').disabled = true; desenhar(true);
    try {
      const { resposta } = await funcao('crm-assistente', 'chat', { mensagens: msgs.map(({ role, content }) => ({ role, content })) });
      msgs.push({ role: 'assistant', content: resposta }); gravarChat(msgs);
    } catch (e) { msgs.push({ role: 'assistant', content: '⚠️ ' + e.message }); }
    $('#bEnviar') && ($('#bEnviar').disabled = false); desenhar();
  };
  desenhar();
  if (!msgs.length) { msgs.push({ role: 'user', content: PEDIDO_RESUMO, oculta: true }); perguntar(); } // resumo do dia ao abrir
  $('#fChat').onsubmit = e => { e.preventDefault(); const t = $('#pergunta').value.trim(); if (!t) return; $('#pergunta').value = ''; perguntar(t); };
  $('#pergunta').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#fChat').requestSubmit(); } };
  main.querySelectorAll('.sugestoes button').forEach(b => b.onclick = () => perguntar(b.textContent));
  avisoNotificacoes();
}

// notificações no celular (Web Push). No iPhone só funciona com o app instalado na tela de início.
async function avisoNotificacoes() {
  const el = $('#avisos'); if (!el) return;
  const suporta = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
  const ios = /iphone|ipad/i.test(navigator.userAgent), instalado = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if (!suporta) { el.innerHTML = ios && !instalado ? '<small class="mute">Para receber notificações no iPhone: Compartilhar → Adicionar à Tela de Início, e abra pelo ícone.</small>' : ''; return; }
  const reg = await navigator.serviceWorker.ready;
  const inscrito = await reg.pushManager.getSubscription();
  if (inscrito && Notification.permission === 'granted') {
    el.innerHTML = '<button class="bt peq sec" id="bTestar">Testar notificação</button>';
    $('#bTestar').onclick = async () => { const r = await funcao('crm-assistente', 'testar'); toast(r.enviadas ? 'Notificação enviada' : 'Nenhum aparelho recebeu'); };
    return;
  }
  if (Notification.permission === 'denied') { el.innerHTML = '<small class="mute">Notificações bloqueadas nas configurações do navegador.</small>'; return; }
  el.innerHTML = '<button class="bt sec" id="bNotif">🔔 Receber resumo às 7h30</button>';
  $('#bNotif').onclick = async () => {
    try {
      if (await Notification.requestPermission() !== 'granted') { toast('Permissão negada', true); return; }
      const { publica } = await funcao('crm-assistente', 'chave');
      const bytes = Uint8Array.from(atob(publica.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - publica.length % 4) % 4)), c => c.charCodeAt(0));
      const s = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: bytes });
      await q(sb.from('crm_push').upsert({ endpoint: s.endpoint, inscricao: s.toJSON() }));
      toast('Pronto! Você vai receber o resumo toda manhã'); avisoNotificacoes();
    } catch (e) { toast('Não consegui ativar: ' + e.message, true); }
  };
}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });

rotear();
