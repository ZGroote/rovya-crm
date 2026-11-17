import { sb, $, main, esc, brl, diaLocal, hoje, dataBR, venceu, toast, q, rotulo, preencher, mdHtml, mdTexto, formulario, confirma, listaClientes, opcoesClientes, funcao, baixarCsv, semRede, sessaoSalva, registrarFalha, anexosGrandes, LIMITE_ANEXO_MB, salvar, comPendentes, campos, lerEscritas, limparEscritas, enviarEscritas } from './util.js';
import { producao, STATUS_ENT, FORMATOS, seloPeca } from './producao.js';
import { servicos, propostas, proposta, novaProposta, propostasDoCliente } from './comercial.js';
import { contratos, contrato, novoContrato, alertasContratos, contratosDoCliente } from './contratos.js';
import { documentos, cartaoDrive, ligarCartaoDrive } from './drive.js';
import { financeiro, abaFinanceiro } from './financeiro.js';
import { configuracoes } from './configuracoes.js';
import { relatorios } from './relatorios.js';
import { tarefas, abaTarefas, tarefasDaSemana, linhaTarefa, ligarLinhas, projetosAtivos } from './tarefas.js';

const ETAPAS_FUNIL = [['contato', 'Primeiro contato'], ['diagnostico', 'Diagnóstico'], ['proposta', 'Proposta enviada'], ['negociacao', 'Negociação'], ['ganho', 'Fechado'], ['perdido', 'Perdido']];
const TIPOS_LEAD = [['receptivo', 'Receptivo (chegou até mim)'], ['ativo', 'Ativo (prospecção)']];
const TIPOS_CONTATO = [['reuniao', 'Reunião'], ['ligacao', 'Ligação'], ['mensagem', 'Mensagem'], ['email', 'E-mail'], ['visita', 'Visita'], ['nota', 'Anotação']];
const ONBOARDING_PADRAO = ['Contrato assinado', 'Pasta no Drive criada', 'Briefing recebido', 'Acessos recebidos (redes, site, contas)', 'Reunião de início (kickoff)', 'Cronograma enviado ao cliente', 'Primeira cobrança emitida'];
const STATUS_PROJ = [['ativo', 'Ativo'], ['pausado', 'Pausado'], ['concluido', 'Concluído'], ['arquivado', 'Arquivado']];
const RETENCAO = [['5_anos', 'Guardar 5 anos (padrão fiscal/contratual)'], ['2_anos', 'Guardar 2 anos'], ['permanente', 'Permanente (portfólio)'], ['descartar', 'Descartar dados pessoais ao fim do contrato']];
const TIPOS_MODELO = [['orientacao', 'Orientação de etapa'], ['email', 'E-mail'], ['whatsapp', 'WhatsApp'], ['proposta', 'Proposta'], ['contrato', 'Contrato'], ['termo', 'Termo'], ['outro', 'Outro']];

/* ---------- autenticação ---------- */
// sem internet e com login guardado neste aparelho: abre com os dados salvos (o login é conferido quando a rede voltar)
if (!(navigator.onLine === false && sessaoSalva())) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) location.replace('login.html');
  else { const { data: n } = await sb.auth.mfa.getAuthenticatorAssuranceLevel(); if (n?.nextLevel === 'aal2' && n.currentLevel !== 'aal2') location.replace('login.html'); } // falta o código do MFA
}
$('#sair').onclick = async () => {
  const n = lerFila().length + lerEscritas().length;
  if (n && !await confirma(`${n} coisa(s) feitas sem internet ainda não foram enviadas. Sair apaga isso deste aparelho. Sair mesmo assim?`)) return;
  await sb.auth.signOut().catch(() => { });
  try { localStorage.removeItem(FILA); } catch { }
  limparEscritas();
  await window.caches?.delete('rovya-v1').catch(() => { }); // cópia dos dados (sw.js) não fica no aparelho depois de sair
  location.replace('login.html');
};

// ?copia=1: este é o quadro invisível da cópia completa (só abre telas para o sw.js guardar; ver copiaCompleta)
const COPIA_MODO = new URLSearchParams(location.search).has('copia');

/* ---------- roteador ---------- */
const rotas = { '': inicio, funil, clientes, cliente, projetos, projeto, producao: () => producao(abrirEntrega), financeiro, agenda, modelos, assistente, servicos, propostas, proposta, contratos, contrato, documentos, tarefas, configuracoes, relatorios };
async function rotear() {
  const [r, id] = location.hash.replace(/^#\/?/, '').split('/');
  const fn = rotas[r] || inicio;
  document.querySelectorAll('#nav a').forEach(a => a.classList.toggle('on', a.dataset.r === (r || 'inicio') || (a.dataset.r + 's') === r || (r === 'cliente' && a.dataset.r === 'clientes') || (r === 'projeto' && a.dataset.r === 'projetos') || (r === 'proposta' && a.dataset.r === 'propostas') || (r === 'contrato' && a.dataset.r === 'contratos')));
  main.innerHTML = '<p class="vazio">Carregando…</p>';
  try { await fn(id); } catch (e) {
    console.error(e);
    main.innerHTML = `<p class="vazio">${semRede(e) ? 'Sem internet, e esta tela ainda não tinha sido aberta neste aparelho, então não há cópia salva dela.' : 'Não consegui carregar: ' + esc(e.message)}</p>`;
  }
  if (!COPIA_MODO) main.focus({ preventScroll: true }); // o quadro da cópia não pode roubar o cursor de quem está digitando
}
addEventListener('hashchange', rotear);

/* ---------- dados compartilhados ---------- */
const CAMPOS_CLIENTE = [
  { k: 'nome', l: 'Nome do contato', req: true }, { k: 'empresa', l: 'Empresa / marca (nome fantasia)' },
  { k: 'razao_social', l: 'Razão social', meia: true }, { k: 'documento', l: 'CNPJ / CPF (quando precisar)', meia: true },
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
  const [opsLidas, ents, parc, projs, alertas, tars, falhas] = await Promise.all([
    q(sb.from('crm_oportunidades').select('id,titulo,proximo_passo,proximo_em,etapa,crm_clientes(nome)').not('etapa', 'in', '(ganho,perdido)').not('proximo_em', 'is', null).lte('proximo_em', em7).order('proximo_em')),
    q(sb.from('crm_entregas').select('id,titulo,prazo,status,crm_etapas!inner(projeto_id,crm_projetos!inner(nome,status))').neq('status', 'aprovado').eq('crm_etapas.crm_projetos.status', 'ativo').not('prazo', 'is', null).lte('prazo', em7).order('prazo')),
    q(sb.from('crm_parcelas').select('id,descricao,valor,vencimento,crm_projetos(nome)').eq('tipo', 'receita').is('pago_em', null).lte('vencimento', em7).order('vencimento')),
    q(sb.from('crm_projetos').select('id,nome,crm_clientes(nome),crm_etapas(crm_entregas(status))').eq('status', 'ativo').order('criado_em', { ascending: false })),
    alertasContratos(),
    tarefasDaSemana(),
    sb.from('crm_falhas').select('id,mensagem').eq('resolvida', false).order('quando', { ascending: false }).limit(5).then(r => r.data || [], () => []),
  ]);
  const ops = comPendentes('crm_oportunidades', opsLidas, o => !['ganho', 'perdido'].includes(o.etapa) && o.proximo_em && o.proximo_em <= em7).sort((a, b) => a.proximo_em.localeCompare(b.proximo_em));
  const nFila = lerFila().length, nEsc = lerEscritas().length;
  const avisos = [...falhas.map(f => esc(f.mensagem)), ...(nFila ? [`${nFila} compromisso(s) guardado(s) neste aparelho, esperando internet para ir ao Google.`] : []),
    ...(nEsc ? [`${nEsc} alteração(ões) (tarefas, contatos) guardada(s) neste aparelho, esperando internet.`] : [])];
  const h = new Date().getHours(), saud = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
  const progresso = p => { const es = p.crm_etapas.flatMap(e => e.crm_entregas); return es.length ? Math.round(100 * es.filter(e => e.status === 'aprovado').length / es.length) : 0; };
  main.innerHTML = `
  <div class="topo"><div><div class="eyebrow">${new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</div><h1>${saud}, Sabrina</h1></div>
    <div class="acoes"><button class="bt sec" id="nOp">+ Oportunidade</button><button class="bt" id="nCli">+ Cliente</button></div></div>
  ${avisos.length ? `<section class="card avisos"><h3>Avisos</h3><ul class="lista">${avisos.map(a => `<li>⚠ ${a}</li>`).join('')}</ul>${falhas.length ? '<p><a href="#/configuracoes" class="mute">Ver e marcar como resolvidos →</a></p>' : ''}</section>` : ''}
  <div class="grade2">
    <section class="card"><h3>Próximos passos</h3><ul class="lista">${ops.map(o => `<li><div class="cresce"><b>${esc(o.proximo_passo || o.titulo)}</b><small>${esc(o.crm_clientes?.nome)} · ${esc(rotulo(ETAPAS_FUNIL, o.etapa))}</small></div><span class="${venceu(o.proximo_em) ? 'atrasado' : 'mute'}">${dataBR(o.proximo_em)}</span></li>`).join('') || '<li class="vazio">Nada para esta semana.</li>'}</ul><p><a href="#/funil" class="mute">Ver funil →</a></p></section>
    <section class="card"><h3>Entregas com prazo</h3><ul class="lista">${ents.map(e => `<li><div class="cresce"><b>${esc(e.titulo)}</b><small>${esc(e.crm_etapas.crm_projetos.nome)}</small></div><span class="pill p-${e.status}">${rotulo(STATUS_ENT, e.status)}</span><span class="${venceu(e.prazo) ? 'atrasado' : 'mute'}">${dataBR(e.prazo)}</span></li>`).join('') || '<li class="vazio">Nenhum prazo nos próximos 7 dias.</li>'}</ul></section>
    <section class="card"><h3>A receber</h3><ul class="lista">${parc.map(p => `<li><div class="cresce"><b>${brl(p.valor)}</b><small>${esc(p.crm_projetos?.nome)}${p.descricao ? ' · ' + esc(p.descricao) : ''}</small></div><span class="${venceu(p.vencimento) ? 'atrasado' : 'mute'}">${venceu(p.vencimento) ? 'atrasada · ' : ''}${dataBR(p.vencimento)}</span></li>`).join('') || '<li class="vazio">Nenhuma parcela vencendo.</li>'}</ul><p><a href="#/financeiro" class="mute">Ver financeiro →</a></p></section>
    ${alertas.length ? `<section class="card"><h3>Contratos</h3><ul class="lista">${alertas.map(a => `<li><a class="cresce" href="${a.href}"><b>${esc(a.titulo)}</b><small>${esc(a.sub)}</small></a><span class="${a.atrasado ? 'atrasado' : 'mute'}">${dataBR(a.data)}</span></li>`).join('')}</ul><p><a href="#/contratos" class="mute">Ver contratos →</a></p></section>` : ''}
    <section class="card" id="cTarefas"><h3>Tarefas</h3><ul class="lista">${tars.map(linhaTarefa).join('') || '<li class="vazio">Nenhuma tarefa para esta semana.</li>'}</ul><p><a href="#/tarefas" class="mute">Ver tarefas →</a></p></section>
    <section class="card" id="agHoje"><h3>Agenda de hoje</h3><p class="vazio">Carregando…</p></section>
  </div>
  <h2 style="margin:28px 0 12px">Projetos ativos</h2>
  <div class="grade">${projs.map(p => `<a class="card linkcard" href="#/projeto/${p.id}"><b>${esc(p.nome)}</b><p class="mute" style="margin:2px 0 12px">${esc(p.crm_clientes?.nome)}</p><div class="barra"><i style="width:${progresso(p)}%"></i></div><small class="mute">${progresso(p)}% aprovado</small></a>`).join('') || '<p class="vazio">Nenhum projeto ativo.</p>'}</div>`;
  $('#nCli').onclick = async () => { const c = await novoCliente(); if (c) location.hash = '#/cliente/' + c.id; };
  $('#nOp').onclick = async () => { if (await novaOportunidade()) location.hash = '#/funil'; };
  ligarLinhas($('#cTarefas'), tars, inicio);
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
    { k: 'tipo_lead', l: 'Tipo de lead', t: 'select', o: TIPOS_LEAD },
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
    { k: 'tipo_lead', l: 'Tipo de lead', t: 'select', o: TIPOS_LEAD },
    { k: 'proximo_passo', l: 'Próximo passo' }, { k: 'proximo_em', l: 'Quando', t: 'date' },
    { k: 'motivo_perda', l: 'Se perdido: motivo' }, { k: 'notas', l: 'Notas', t: 'textarea', linhas: 4 }], o,
    `<div class="acoes"><a class="bt peq fantasma" href="#/cliente/${o.cliente_id}" onclick="document.getElementById('dlg').close()">Abrir ficha do cliente →</a><button class="bt peq sec" value="contato" formnovalidate>Registrar contato</button><button class="bt peq sec" value="proposta" formnovalidate>Criar proposta</button></div>`);
  if ($('#dlg').returnValue === 'contato') return registrarContato(o.cliente_id, o);
  if ($('#dlg').returnValue === 'proposta') return novaProposta({ cliente_id: o.cliente_id, oportunidade_id: o.id, titulo: o.titulo });
  if (!v) return;
  await moverOportunidade(o, v.etapa, v);
}
// histórico do lead/cliente; com oportunidade, já atualiza o próximo passo (fluxo: reunião → próxima ação)
async function registrarContato(clienteId, o = null, x = null) {
  const campos = [{ k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS_CONTATO, meia: true }, { k: 'data', l: 'Data', t: 'date', req: true, meia: true },
    { k: 'resumo', l: 'O que foi conversado', t: 'textarea', linhas: 5, req: true }];
  if (o) campos.push({ k: 'proximo_passo', l: 'Próximo passo (atualiza o funil)' }, { k: 'proximo_em', l: 'Quando', t: 'date' });
  const v = await formulario(x ? 'Editar registro' : 'Registrar contato', campos, x || { tipo: 'reuniao', data: hoje(), proximo_passo: o?.proximo_passo, proximo_em: o?.proximo_em },
    x ? '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar registro</button>' : '');
  if (x && $('#dlg').returnValue === 'apagar') { if (await confirma('Apagar este registro do histórico?')) await salvar({ tabela: 'crm_interacoes', acao: 'delete', id: x.id, rotulo: 'Registro de contato' }); return true; }
  if (!v) return false;
  const { proximo_passo, proximo_em, ...reg } = v;
  const rot = `Contato de ${dataBR(reg.data)}`;
  let r = x ? await salvar({ tabela: 'crm_interacoes', acao: 'update', id: x.id, dados: reg, antes: campos(x, Object.keys(reg)), rotulo: rot })
    : await salvar({ tabela: 'crm_interacoes', acao: 'insert', dados: { ...reg, cliente_id: clienteId, oportunidade_id: o?.id ?? null }, rotulo: rot });
  if (o && (o.proximo_passo !== proximo_passo || o.proximo_em !== proximo_em)) {
    const r2 = await salvar({ tabela: 'crm_oportunidades', acao: 'update', id: o.id, dados: { proximo_passo, proximo_em, atualizado_em: new Date().toISOString() },
      antes: campos(o, ['proximo_passo', 'proximo_em']), rotulo: `Próximo passo de “${o.titulo}”` });
    if (r2 !== true) r = r2;
  }
  if (r === true) toast('Registrado no histórico'); return true;
}
async function moverOportunidade(o, etapa, extra = {}) {
  const fim = ['ganho', 'perdido'].includes(etapa), agora = new Date().toISOString();
  await q(sb.from('crm_oportunidades').update({ ...extra, etapa, atualizado_em: agora, fechado_em: fim ? (o.fechado_em && o.etapa === etapa ? o.fechado_em : agora) : null }).eq('id', o.id));
  if (etapa === 'ganho' && o.etapa !== 'ganho') {
    const proj = await q(sb.from('crm_projetos').select('id').eq('oportunidade_id', o.id));
    if (!proj.length) await criarProjeto(o.cliente_id, o.titulo, o.id, o.valor);
  }
}
async function funil() {
  const ops = comPendentes('crm_oportunidades', await q(sb.from('crm_oportunidades').select('*,crm_clientes(nome,empresa)').order('ordem')));
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Funil</h1><p>Arraste os cartões entre as colunas. Ao chegar em “Fechado”, o projeto é criado a partir do seu modelo.</p></div>
    <button class="bt" id="nOp">+ Oportunidade</button></div>
    <div class="funil">${ETAPAS_FUNIL.map(([k, l]) => {
      const lst = ops.filter(o => o.etapa === k), tot = lst.reduce((s, o) => s + (Number(o.valor) || 0), 0);
      return `<section class="col" data-etapa="${k}"><header><b>${l}</b><span>${lst.length}${tot ? ' · ' + brl(tot) : ''}</span></header>
      ${lst.map(o => `<article class="op" draggable="true" data-id="${o.id}"><b>${esc(o.crm_clientes?.empresa || o.crm_clientes?.nome)}</b>${o.tipo_lead === 'ativo' ? ' <span class="pill" title="Prospecção ativa">ativo</span>' : ''}<small>${esc(o.titulo)}</small>
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
  const desenha = f => $('#tb').innerHTML = cs.filter(c => !f || [c.codigo, c.nome, c.empresa, c.email, c.instagram].join(' ').toLowerCase().includes(f))
    .map(c => `<tr style="cursor:pointer" data-id="${c.id}"><td>${c.codigo ? `<small class="mute">${esc(c.codigo)}</small> ` : ''}<b>${esc(c.nome)}</b><br><small class="mute">${esc(c.empresa)}</small></td><td class="esconde-cel"><small>${esc(c.email)}<br>${esc(c.telefone)}</small></td><td>${sit(c)}</td></tr>`).join('')
    || '<tr><td colspan="3" class="vazio">Nenhum cliente ainda.</td></tr>';
  desenha();
  $('#busca').oninput = e => desenha(e.target.value.toLowerCase().trim());
  $('#tb').onclick = e => { const tr = e.target.closest('tr[data-id]'); if (tr) location.hash = '#/cliente/' + tr.dataset.id; };
  $('#nCli').onclick = async () => { const c = await novoCliente(); if (c) location.hash = '#/cliente/' + c.id; };
}
async function cliente(id) {
  const [c] = await q(sb.from('crm_clientes').select('*,crm_oportunidades(*),crm_projetos(id,nome,status,valor),crm_interacoes(*)').eq('id', id));
  c.crm_interacoes = comPendentes('crm_interacoes', c.crm_interacoes, x => x.cliente_id === id); c.crm_oportunidades = comPendentes('crm_oportunidades', c.crm_oportunidades);
  c.crm_interacoes.sort((a, b) => b.data.localeCompare(a.data) || (b.criado_em || '').localeCompare(a.criado_em || ''));
  if (!c) { main.innerHTML = '<p class="vazio">Cliente não encontrado.</p>'; return; }
  const zap = c.telefone ? 'https://wa.me/' + c.telefone.replace(/\D/g, '').replace(/^(?!55)/, '55') : null;
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/clientes">Clientes</a>${c.codigo ? ' · ' + esc(c.codigo) : ''}</div><h1>${esc(c.nome)}</h1><p>${esc(c.empresa)}</p></div>
    <div class="acoes">${zap ? `<a class="bt sec" href="${zap}" target="_blank" rel="noopener">WhatsApp</a>` : ''}${c.email ? `<a class="bt sec" href="mailto:${esc(c.email)}">E-mail</a>` : ''}
    <button class="bt sec" id="agendar">Agendar reunião</button><button class="bt sec" id="ed">Editar</button><button class="bt" id="nOp">+ Oportunidade</button></div></div>
  <div class="grade2">
    <section class="card"><h3>Dados</h3><ul class="lista">
      ${[['Código', c.codigo], ['Razão social', c.razao_social], ['CNPJ/CPF', c.documento], ['E-mail', c.email], ['WhatsApp', c.telefone], ['Instagram', c.instagram], ['Origem', c.origem], ['Cliente desde', c.cliente_desde ? new Date(c.cliente_desde + 'T12:00').toLocaleDateString('pt-BR') : null], ['Primeiro contato', dataBR(c.criado_em.slice(0, 10))]].filter(x => x[1]).map(([l, v]) => `<li><span class="mute" style="min-width:110px">${l}</span><span>${esc(v)}</span></li>`).join('')}</ul>
      ${c.notas ? `<p style="white-space:pre-wrap">${esc(c.notas)}</p>` : ''}</section>
    <section class="card"><h3>Projetos</h3><ul class="lista">${c.crm_projetos.map(p => `<li><a class="cresce" href="#/projeto/${p.id}"><b>${esc(p.nome)}</b></a><span class="pill">${rotulo(STATUS_PROJ, p.status)}</span></li>`).join('') || '<li class="vazio">Nenhum projeto.</li>'}</ul>
      <button class="bt peq sec" id="nProj">+ Projeto</button></section>
    <section class="card"><h3>Oportunidades</h3><ul class="lista">${c.crm_oportunidades.map(o => `<li data-op="${o.id}" style="cursor:pointer"><div class="cresce"><b>${esc(o.titulo)}</b><small>${o.valor ? brl(o.valor) + ' · ' : ''}${esc(o.proximo_passo || '')}</small></div><span class="pill">${rotulo(ETAPAS_FUNIL, o.etapa)}</span></li>`).join('') || '<li class="vazio">Nenhuma oportunidade.</li>'}</ul></section>
    <section class="card"><h3>Histórico</h3><ul class="lista">${c.crm_interacoes.slice(0, 15).map(x => `<li data-hist="${x.id}" style="cursor:pointer;align-items:flex-start"><span class="pill">${rotulo(TIPOS_CONTATO, x.tipo)}</span><div class="cresce"><small style="white-space:pre-wrap;color:var(--ink)">${esc(x.resumo)}</small></div>${x._pendente ? '<span class="pill pend" title="Guardado neste aparelho; vai para o banco quando a internet voltar">⏳</span>' : ''}<span class="mute">${dataBR(x.data)}</span></li>`).join('') || '<li class="vazio">Nenhum contato registrado.</li>'}</ul>
      <button class="bt peq sec" id="nHist">+ Registrar contato</button></section>
    <section class="card"><h3>Onboarding</h3>${c.onboarding ? `<p class="mute" style="margin:0 0 6px">${c.onboarding.filter(i => i.feito).length} de ${c.onboarding.length} feitos</p>
      <ul class="lista">${c.onboarding.map((i, n) => `<li><label style="display:flex;gap:10px;align-items:center;cursor:pointer;flex:1${i.feito ? ';color:var(--mute);text-decoration:line-through' : ''}"><input type="checkbox" data-onb="${n}" ${i.feito ? 'checked' : ''}> ${esc(i.item)}</label></li>`).join('')}</ul>
      <button class="bt peq fantasma" id="onbItem">+ Item</button>`
      : `<p class="mute">Checklist de entrada do cliente: contrato, pasta, briefing, acessos, kickoff…</p><button class="bt peq sec" id="onbIni">Iniciar onboarding</button>`}</section>
    ${await propostasDoCliente(id)}${await contratosDoCliente(id)}${await cartaoDrive(c)}
  </div>`;
  ligarCartaoDrive(c, () => cliente(id));
  $('#nHist').onclick = async () => { if (await registrarContato(id)) cliente(id); };
  main.querySelectorAll('[data-hist]').forEach(li => li.onclick = async () => { if (await registrarContato(id, null, c.crm_interacoes.find(x => x.id === li.dataset.hist))) cliente(id); });
  const salvarOnb = async lista => { await q(sb.from('crm_clientes').update({ onboarding: lista }).eq('id', id)); cliente(id); };
  if ($('#onbIni')) $('#onbIni').onclick = () => salvarOnb(ONBOARDING_PADRAO.map(item => ({ item, feito: false })));
  main.querySelectorAll('[data-onb]').forEach(cb => cb.onchange = () => salvarOnb(c.onboarding.map((i, n) => n === +cb.dataset.onb ? { ...i, feito: cb.checked } : i)));
  if ($('#onbItem')) $('#onbItem').onclick = async () => { const v = await formulario('Novo item do onboarding', [{ k: 'item', l: 'Item', req: true }]); if (v) salvarOnb([...c.onboarding, { item: v.item, feito: false }]); };
  main.querySelector('[data-nova-proposta]').onclick = () => novaProposta({ cliente_id: id });
  main.querySelector('[data-novo-contrato]').onclick = () => novoContrato({ cliente_id: id });
  $('#ed').onclick = async () => {
    const v = await formulario('Editar cliente', CAMPOS_CLIENTE, c, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar cliente</button>');
    if ($('#dlg').returnValue === 'apagar') { if (await confirma(`Apagar ${c.nome} e tudo ligado a ele?`)) { await q(sb.from('crm_clientes').delete().eq('id', id)); location.hash = '#/clientes'; } return; }
    if (v) { await q(sb.from('crm_clientes').update(v).eq('id', id)); toast('Salvo'); cliente(id); }
  };
  $('#nOp').onclick = async () => { if (await novaOportunidade(id)) cliente(id); };
  $('#nProj').onclick = async () => { await criarProjeto(id, c.empresa || c.nome); };
  $('#agendar').onclick = () => novoEvento({ cliente_id: id, titulo: 'Reunião · ' + (c.empresa || c.nome) });
  main.querySelectorAll('[data-op]').forEach(li => li.onclick = async () => { await editarOportunidade(c.crm_oportunidades.find(o => o.id === li.dataset.op)); cliente(id); });
}

/* ---------- PROJETOS ---------- */
// a ficha do contrato pede o projeto por evento (contratos.js não importa app.js)
addEventListener('crm:criar-projeto', async ({ detail: d }) => {
  const pid = await criarProjeto(d.cliente_id, d.nome, null, d.valor);
  if (pid && d.contrato_id) await q(sb.from('crm_contratos').update({ projeto_id: pid }).eq('id', d.contrato_id));
});
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
  toast('Projeto criado'); location.hash = '#/projeto/' + pid; return pid;
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
  const c = p.crm_clientes, recebido = p.crm_parcelas.filter(x => x.pago_em && x.tipo !== 'despesa').reduce((s, x) => s + +x.valor, 0);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/cliente/${c.id}">${esc(c.empresa || c.nome)}</a></div><h1>${esc(p.nome)}</h1>
      <p>${ok} de ${es.length} entregas aprovadas${p.entrega_prevista ? ' · entrega prevista ' + dataBR(p.entrega_prevista) : ''}</p></div>
    <div class="acoes">${p.status === 'arquivado' ? `<span class="pill">Arquivado ${dataBR(p.arquivado_em)}${p.retencao ? ' · ' + esc(rotulo(RETENCAO, p.retencao).split(' (')[0]) : ''}</span><button class="bt sec" id="desarq">Desarquivar</button>`
      : `<select id="st" class="busca" style="min-width:0">${STATUS_PROJ.filter(s => s[0] !== 'arquivado').map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select><button class="bt sec" id="encerrar">Encerrar</button>`}<button class="bt sec" id="ed">Editar</button></div></div>
    <div class="barra" style="margin-bottom:20px"><i style="width:${pct}%"></i></div>
    <div class="tabs"><button data-a="etapas">Etapas e entregas</button><button data-a="tarefas">Tarefas</button><button data-a="financeiro">Financeiro · ${brl(recebido)} de ${brl(p.valor)}</button></div>
    <div id="aba"></div>`;
  main.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.a === aba); b.onclick = () => projeto(id, b.dataset.a); });
  if ($('#st')) $('#st').onchange = async e => { await q(sb.from('crm_projetos').update({ status: e.target.value }).eq('id', id)); toast('Status atualizado'); };
  if ($('#encerrar')) $('#encerrar').onclick = () => encerrarProjeto(p).then(ok => ok && projeto(id, aba));
  if ($('#desarq')) $('#desarq').onclick = async () => { if (!await confirma('Desarquivar? O projeto volta como “Concluído”.')) return; await q(sb.from('crm_projetos').update({ status: 'concluido', arquivado_em: null }).eq('id', id)); projeto(id, aba); };
  $('#ed').onclick = async () => {
    const v = await formulario('Editar projeto', [{ k: 'nome', l: 'Nome', req: true }, { k: 'valor', l: 'Valor do contrato (R$)', t: 'number', meia: true }, { k: 'entrega_prevista', l: 'Entrega prevista', t: 'date', meia: true }], p,
      `<div class="acoes"><button class="bt fantasma" value="modelo" formnovalidate>Salvar estrutura como modelo</button><button class="bt fantasma" value="apagar" formnovalidate style="color:var(--bad)">Apagar projeto</button></div>`);
    const rv = $('#dlg').returnValue;
    if (rv === 'apagar') { if (await confirma(`Apagar o projeto “${p.nome}”?`)) { await q(sb.from('crm_projetos').delete().eq('id', id)); location.hash = '#/projetos'; } return; }
    if (rv === 'modelo') return salvarComoModelo(p);
    if (v) { await q(sb.from('crm_projetos').update(v).eq('id', id)); projeto(id, aba); }
  };
  const alvo = $('#aba');
  if (aba === 'financeiro') return abaFinanceiro(p, alvo, () => projeto(id, 'financeiro'));
  if (aba === 'tarefas') return abaTarefas(p, alvo);
  alvo.innerHTML = p.crm_etapas.map((e, i) => `<section class="card etapa" data-etapa="${e.id}">
      <header><div><div class="n">ETAPA ${String(i + 1).padStart(2, '0')}</div><h3>${esc(e.titulo)}</h3></div>
        <div class="acoes"><button class="bt peq fantasma" data-ed-etapa="${e.id}">Editar etapa</button><button class="bt peq sec" data-nova-ent="${e.id}">+ Entrega</button></div></header>
      ${e.orientacao ? `<details class="ori"><summary>Orientação para o cliente</summary><div class="txt">${mdHtml(preencher(e.orientacao, c))}</div><button class="bt peq sec" data-copiar="${e.id}">Copiar texto</button></details>` : ''}
      ${e.crm_entregas.map(x => `<div class="ent" data-ent="${x.id}">
        <span class="mute" title="${x.crm_anexos.length} arquivo(s)">${x.crm_anexos.length ? '📎' : ''}</span>
        <span class="t">${esc(x.titulo)} ${seloPeca(x)}${x.prazo ? ` <small class="${venceu(x.prazo) && x.status !== 'aprovado' ? 'atrasado' : ''}">· ${dataBR(x.prazo)}</small>` : ''}</span>
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
    <input type="file" id="arq" multiple> <small class="mute">até ${LIMITE_ANEXO_MB} MB por arquivo</small></div></div>
    ${x.revisoes || x.aprovado_em ? `<small class="mute">${x.revisoes ? `Voltou ${x.revisoes}× para revisão. ` : ''}${x.aprovado_em ? 'Aprovada em ' + new Date(x.aprovado_em).toLocaleDateString('pt-BR') + '.' : ''}</small>` : ''}
    <button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar entrega</button>`;
  const pr = formulario(x.titulo, [
    { k: 'titulo', l: 'Entrega', req: true },
    { k: 'status', l: 'Status', t: 'select', o: STATUS_ENT, meia: true }, { k: 'prazo', l: 'Prazo', t: 'date', meia: true },
    { k: 'formato', l: 'Formato da peça', t: 'select', o: [['', '—'], ...[...new Set([...FORMATOS, 'Outro', x.formato].filter(Boolean))].map(f => [f, f])] },
    { k: 'texto', l: 'Texto de entrega para o cliente', t: 'textarea', linhas: 9 },
    { k: 'link', l: 'Link (Canva, Heyzine, Drive…)' }], { ...x, texto: x.texto ?? `${(p.crm_clientes.nome || '').split(' ')[0]}, ` }, extra);
  $('#dlgf').querySelectorAll('[data-del-anexo]').forEach(b => b.onclick = async () => {
    const a = anexos.find(z => z.id === b.dataset.delAnexo);
    await q(sb.storage.from('crm-anexos').remove([a.caminho])); await q(sb.from('crm_anexos').delete().eq('id', a.id)); b.parentElement.remove(); toast('Arquivo removido');
  });
  const arquivos = $('#arq');
  arquivos.onchange = () => { if (anexosGrandes(arquivos.files)) arquivos.value = ''; }; // avisa já na escolha, antes de salvar
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
/* ---------- ENCERRAMENTO (Manual Mestre: pendências → exportar entregáveis → retenção → arquivar) ---------- */
async function encerrarProjeto(p) {
  const es = p.crm_etapas.flatMap(e => e.crm_entregas);
  const [tarefas, contratos] = await Promise.all([
    q(sb.from('crm_tarefas').select('titulo').eq('projeto_id', p.id).neq('status', 'feita')),
    q(sb.from('crm_contratos').select('titulo').eq('projeto_id', p.id).in('status', ['vigente', 'assinatura']))]);
  const aReceber = p.crm_parcelas.filter(x => x.tipo !== 'despesa' && !x.pago_em), abertas = es.filter(x => x.status !== 'aprovado');
  const pend = [
    ...(abertas.length > 5 ? [`<b>${abertas.length} peças não aprovadas</b> (${STATUS_ENT.map(([k, l]) => [l, abertas.filter(x => x.status === k).length]).filter(z => z[1]).map(([l, n]) => `${n} ${l.toLowerCase()}`).join(', ')})`]
      : abertas.map(x => `Peça não aprovada: <b>${esc(x.titulo)}</b> (${esc(rotulo(STATUS_ENT, x.status))})`)),
    ...tarefas.map(t => `Tarefa aberta: <b>${esc(t.titulo)}</b>`),
    ...aReceber.map(x => `A receber: <b>${esc(x.descricao || 'parcela')}</b> ${brl(x.valor)} · venc. ${dataBR(x.vencimento)}`),
    ...contratos.map(k => `Contrato ainda vigente: <b>${esc(k.titulo)}</b>`)];
  const pr = formulario('Encerrar “' + p.nome + '”', [{ k: 'retencao', l: 'Retenção dos dados e arquivos', t: 'select', o: RETENCAO, req: true }], { retencao: '5_anos' },
    `<div><label>Pendências</label>${pend.length ? `<ul style="margin:6px 0 0;padding-left:18px;line-height:1.6">${pend.map(x => `<li>${x}</li>`).join('')}</ul>` : '<p class="mute" style="margin:4px 0">Nenhuma pendência. ✓</p>'}</div>
     <div><label>Entregáveis</label><button type="button" class="bt peq sec" id="csvEnt">Baixar lista de entregáveis (CSV)</button> <small class="mute">peças, status, links e arquivos</small></div>
     ${pend.length ? `<label style="display:flex;gap:8px;align-items:flex-start;font-weight:400"><input type="checkbox" required style="width:auto;margin-top:3px"> Conferi as ${pend.length} pendência(s) acima e quero arquivar mesmo assim.</label>` : ''}
     <small class="mute">Arquivar não apaga nada: o projeto sai do Início e da Produção e fica em Projetos → Arquivado.</small>`, 'Arquivar projeto');
  $('#csvEnt').onclick = () => csvEntregaveis(p);
  const v = await pr; if (!v) return false;
  await q(sb.from('crm_projetos').update({ status: 'arquivado', arquivado_em: hoje(), retencao: v.retencao }).eq('id', p.id));
  toast('Projeto arquivado'); return true;
}
async function csvEntregaveis(p) {
  const ids = p.crm_etapas.flatMap(e => e.crm_entregas.map(x => x.id));
  const anexos = ids.length ? await q(sb.from('crm_anexos').select('entrega_id,nome').in('entrega_id', ids)) : [];
  const dt = d => d ? d.slice(0, 10).split('-').reverse().join('/') : '';
  const linhas = [['Etapa', 'Peça', 'Formato', 'Status', 'Revisões', 'Aprovada em', 'Link', 'Arquivos no CRM']];
  for (const e of p.crm_etapas) for (const x of e.crm_entregas)
    linhas.push([e.titulo, x.titulo, x.formato, rotulo(STATUS_ENT, x.status), x.revisoes || 0, dt(x.aprovado_em), x.link, anexos.filter(a => a.entrega_id === x.id).map(a => a.nome).join(' | ')]);
  baixarCsv(linhas, `ROVYA_${p.crm_clientes.codigo || 'CLIENTE'}_ENTREGAVEIS_${hoje()}_V01.csv`);
}
async function salvarComoModelo(p) {
  const v = await formulario('Salvar como modelo', [{ k: 'titulo', l: 'Nome do modelo', req: true }], { titulo: p.nome });
  if (!v) return;
  const tirar = t => (t || '').replaceAll(p.crm_clientes.empresa || '\u0000', '{{empresa}}').replaceAll((p.crm_clientes.nome || '\u0000').split(' ')[0], '{{contato}}');
  const estrutura = p.crm_etapas.map(e => ({ titulo: e.titulo, orientacao: tirar(e.orientacao), entregas: e.crm_entregas.map(x => x.titulo) }));
  await q(sb.from('crm_modelos').insert({ tipo: 'projeto', titulo: v.titulo, estrutura })); toast('Modelo salvo');
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
const google = (acao, dados) => funcao('crm-google', acao, dados);
const horaEv = e => e.start?.dateTime ? new Date(e.start.dateTime).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'dia todo';

/* compromisso criado sem internet fica guardado neste aparelho e vai para o Google quando a conexão voltar.
   Se ao enviar o horário já estiver ocupado no Google, ele é criado mesmo assim (nada se perde) e vira um aviso para a Sabrina. */
const FILA = 'rovya-agenda-pendentes';
const lerFila = () => { try { return JSON.parse(localStorage.getItem(FILA)) || []; } catch { return []; } };
const gravarFila = f => localStorage.setItem(FILA, JSON.stringify(f)); // pode lançar (aparelho sem espaço): quem chama avisa
const idEvento = () => 'crm' + Date.now().toString(32) + Math.random().toString(32).slice(2, 8); // formato que o Google aceita; reenviar não duplica
const quandoEv = ev => new Date(ev.start.dateTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
function guardarPendente(evento) {
  try { gravarFila([...lerFila().filter(p => p.evento.id !== evento.id), { evento, guardado_em: new Date().toISOString() }]); }
  catch { toast('Não consegui guardar neste aparelho (sem espaço?). Anote o compromisso e tente de novo.', true); return false; }
  toast('Sem internet: guardado neste aparelho. Vai para o Google quando a conexão voltar.'); return true;
}
function enviarPendentes() {
  if (!navigator.onLine || !lerFila().length) return;
  // uma aba por vez (duas abas abertas não enviam o mesmo compromisso)
  return navigator.locks ? navigator.locks.request('rovya-agenda', { ifAvailable: true }, l => l && enviarFila()) : enviarFila();
}
async function enviarFila() {
  let enviados = 0, conflitos = 0;
  const marcar = (id, erro) => { try { gravarFila(lerFila().map(p => p.evento.id === id ? { ...p, erro } : p)); } catch { } };
  for (const { evento, erro: erroAntes } of lerFila()) {
    let r;
    try { r = await google('listar', { de: evento.start.dateTime, ate: evento.end.dateTime, fresco: true }); }
    catch (e) { if (semRede(e)) break; marcar(evento.id, e.message); continue; }
    if (r.conectado === false) {
      const m = 'Google Agenda não conectado';
      if (erroAntes !== m) registrarFalha('agenda', 'compromisso guardado', `“${evento.summary}” (${quandoEv(evento)}) está guardado no aparelho, mas o Google Agenda não está conectado. Conecte em Agenda para enviar.`);
      marcar(evento.id, m); continue;
    }
    if (!r.eventos.some(e => e.id === evento.id)) { // já criado numa tentativa que perdeu a resposta? então não cria de novo
      try { await google('criar', { evento }); }
      catch (e) { if (semRede(e)) break; if (!/already exists/i.test(e.message)) { marcar(evento.id, e.message); continue; } }
    }
    const choque = r.eventos.filter(e => e.id !== evento.id && e.start?.dateTime && e.status !== 'cancelled' && e.transparency !== 'transparent');
    if (choque.length) {
      conflitos++;
      registrarFalha('agenda', 'conflito de horário', `“${evento.summary}” (${quandoEv(evento)}) foi marcado sem internet e ficou no mesmo horário de ${choque.map(e => '“' + (e.summary || 'sem título') + '” (' + horaEv(e) + ')').join(', ')}. Confira na Agenda.`);
    }
    try { gravarFila(lerFila().filter(p => p.evento.id !== evento.id)); } catch { }
    enviados++;
  }
  if (!enviados) return;
  toast(`${enviados} compromisso(s) marcado(s) sem internet foram para o Google${conflitos ? ` · ${conflitos} com conflito de horário: veja o aviso no Início` : ''}`, conflitos > 0);
  if (!$('#dlg').open && /^(#\/?)?(agenda)?$/.test(location.hash)) rotear();
}

async function novoEvento(val = {}, ev = null) {
  const cs = await listaClientes().catch(() => []);
  const v = await formulario(ev ? 'Editar compromisso' : 'Novo compromisso', [
    { k: 'titulo', l: 'Título', req: true }, { k: 'cliente_id', l: 'Cliente (opcional)', t: 'select', o: [['', '—'], ...opcoesClientes(cs)] },
    { k: 'data', l: 'Data', t: 'date', req: true, meia: true }, { k: 'hora', l: 'Início', t: 'time', req: true, meia: true },
    { k: 'duracao', l: 'Duração (min)', t: 'number', meia: true }, { k: 'local', l: 'Local ou link', meia: true }, { k: 'notas', l: 'Notas', t: 'textarea', linhas: 3 }],
    { data: hoje(), hora: '10:00', duracao: 60, ...val }, ev ? '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar compromisso</button>' : '');
  if ($('#dlg').returnValue === 'apagar') {
    if (ev.pendente) {
      if (!await confirma('Apagar este compromisso que ainda não foi para o Google?')) return false;
      try { gravarFila(lerFila().filter(p => p.evento.id !== ev.id)); } catch { }
      toast('Apagado'); return true;
    }
    if (await confirma('Apagar do Google Agenda também?')) {
      try { await google('apagar', { id: ev.id }); } catch (e) { toast(semRede(e) ? 'Sem internet: apagar um compromisso que já está no Google precisa de conexão.' : e.message, true); return false; }
      toast('Apagado'); return true;
    }
    return false;
  }
  if (!v) return false;
  const ini = new Date(`${v.data}T${v.hora}`), fim = new Date(ini.getTime() + (v.duracao || 60) * 6e4);
  const evento = { summary: v.titulo, location: v.local || undefined, description: v.notas || undefined, start: { dateTime: ini.toISOString() }, end: { dateTime: fim.toISOString() },
    extendedProperties: { private: { crm_cliente: v.cliente_id || '' } } };
  if (ev?.pendente) { const ok = guardarPendente({ ...evento, id: ev.id }); enviarPendentes(); return ok; }
  if (!ev) evento.id = idEvento();
  if (!ev && !navigator.onLine) return guardarPendente(evento);
  try { await google(ev ? 'editar' : 'criar', { id: ev?.id, evento }); }
  catch (e) {
    if (!ev && semRede(e)) return guardarPendente(evento);
    toast(semRede(e) ? 'Sem internet: alterar um compromisso que já está no Google precisa de conexão.' : e.message, true); return false;
  }
  toast(ev ? 'Compromisso atualizado' : 'Criado no Google Agenda'); return true;
}
async function agenda() {
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Google Agenda</div><h1>Agenda</h1><p id="agSub">Carregando…</p></div><div class="acoes" id="agAcoes"></div></div><div id="agLista"></div>`;
  const de = new Date(); de.setHours(0, 0, 0, 0); const ate = new Date(de.getTime() + 21 * 864e5);
  const pend = lerFila().map(p => ({ ...p.evento, pendente: true, erro: p.erro }));
  let r; try { r = await google('listar', { de: de.toISOString(), ate: ate.toISOString() }); }
  catch (e) { r = { falhou: semRede(e) ? 'Sem internet e sem cópia salva da agenda. Os compromissos marcados neste aparelho aparecem abaixo.' : e.message, eventos: [] }; }
  if (r.conectado === false) {
    $('#agSub').textContent = 'Conecte a conta Google da Rovya para ver e criar compromissos daqui.';
    $('#agAcoes').innerHTML = '<button class="bt" id="con">Conectar Google Agenda</button>';
    $('#con').onclick = async () => { const { url } = await google('url', { volta: location.href.split('#')[0] + '#/agenda' }); location.href = url; };
    if (!pend.length) return;
    r.eventos = [];
  } else {
    $('#agSub').textContent = r.falhou || (navigator.onLine ? `Conectada a ${r.email} · próximas 3 semanas` : 'Sem internet · agenda como estava na última vez que abriu com conexão');
    $('#agAcoes').innerHTML = (r.falhou ? '' : '<button class="bt sec" id="desc">Desconectar</button>') + '<button class="bt" id="nEv">+ Compromisso</button>';
  }
  const cs = Object.fromEntries((await listaClientes().catch(() => [])).map(c => [c.id, c]));
  const evs = [...r.eventos.filter(e => !pend.some(p => p.id === e.id)), ...pend]
    .sort((a, b) => new Date(a.start.dateTime || a.start.date + 'T00:00') - new Date(b.start.dateTime || b.start.date + 'T00:00'));
  const dias = {}; for (const e of evs) { const d = e.start.dateTime ? new Date(e.start.dateTime).toLocaleDateString('sv') : e.start.date; (dias[d] ||= []).push(e); }
  const dia = d => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#agLista').innerHTML = Object.entries(dias).map(([d, evs]) => `<section class="dia"><h3>${d === hoje() ? 'Hoje · ' : ''}${dia(d)}</h3>${evs.map(e => {
    const cid = e.extendedProperties?.private?.crm_cliente, c = cs[cid];
    return `<div class="ev ${c ? 'crm' : ''} ${e.pendente ? 'pendente' : ''}" data-ev="${esc(e.id)}"><span class="h">${horaEv(e)}</span><div><b>${esc(e.summary || '(sem título)')}</b>${c ? `<br><small class="mute">${esc(c.nome)}</small>` : ''}${e.location ? `<br><small class="mute">${esc(e.location)}</small>` : ''}${e.pendente ? `<br><small class="pend">${e.erro ? '⚠ Não enviado: ' + esc(e.erro) : '⏳ Guardado neste aparelho · vai para o Google quando a internet voltar'}</small>` : ''}</div></div>`;
  }).join('')}</section>`).join('') || '<p class="vazio">Nenhum compromisso nas próximas 3 semanas.</p>';
  const porId = Object.fromEntries(evs.map(e => [e.id, e]));
  main.querySelectorAll('[data-ev]').forEach(el => el.onclick = async () => {
    const e = porId[el.dataset.ev]; if (!e.start.dateTime) { window.open(e.htmlLink, '_blank'); return; }
    const ini = new Date(e.start.dateTime), fim = new Date(e.end.dateTime);
    const ok = await novoEvento({ titulo: e.summary, cliente_id: e.extendedProperties?.private?.crm_cliente || '', data: ini.toLocaleDateString('sv'), hora: ini.toTimeString().slice(0, 5), duracao: Math.round((fim - ini) / 6e4), local: e.location, notas: e.description }, e);
    if (ok) agenda();
  });
  if ($('#nEv')) $('#nEv').onclick = async () => { if (await novoEvento()) agenda(); };
  if ($('#desc')) $('#desc').onclick = async () => { if (await confirma('Desconectar o Google Agenda?')) { await google('desconectar'); agenda(); } };
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
/* ---------- cópia completa no aparelho ----------
   A cada 30 min (com o CRM aberto e internet), abre cada tela e cada ficha num quadro invisível;
   o sw.js guarda as respostas, então sem internet tudo abre com a versão mais nova, mesmo o que ela não abriu.
   Com o CRM fechado o navegador não deixa rodar: a cópia se atualiza na próxima vez que ela abrir. */
const COPIA = 'rovya-copia-em';
const ultimaCopia = () => { try { return +localStorage.getItem(COPIA) || 0; } catch { return 0; } };
const marcarCopia = () => { const t = ultimaCopia(); if (t) main.dataset.copia = ' Cópia completa de ' + new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) + '.'; };
function copiaCompleta() {
  if (!navigator.onLine || !navigator.serviceWorker?.controller || Date.now() - ultimaCopia() < 29 * 6e4) return;
  return navigator.locks ? navigator.locks.request('rovya-copia', { ifAvailable: true }, l => l && copiar()) : copiar();
}
async function copiar() {
  const fichas = async (t, rota, filtro = s => s) => ((await filtro(sb.from(t).select('id'))).data || []).map(x => `${rota}/${x.id}`);
  const rotas = ['funil', 'propostas', 'contratos', 'clientes', 'projetos', 'producao', 'tarefas', 'agenda', 'financeiro', 'relatorios', 'documentos', 'servicos', 'modelos', 'configuracoes',
    ...await fichas('crm_clientes', 'cliente'), ...await fichas('crm_projetos', 'projeto', s => s.neq('status', 'arquivado')),
    ...await fichas('crm_contratos', 'contrato'), ...await fichas('crm_propostas', 'proposta')]; // Assistente fica de fora: abrir pede o resumo à IA
  const f = Object.assign(document.createElement('iframe'), { src: location.pathname.split('/').pop() + '?copia=1', hidden: true, title: 'cópia' });
  document.body.append(f);
  try {
    await new Promise((ok, erro) => { const t0 = Date.now(), ver = () => f.contentWindow?.copiaPronta ? ok() : Date.now() - t0 > 30000 ? erro(new Error('o quadro não abriu')) : setTimeout(ver, 200); ver(); });
    await f.contentWindow.copiaPronta; // Início
    for (const r of rotas) {
      if (!navigator.onLine) return; // caiu no meio: não marca como completa
      await f.contentWindow.irPara(r); await new Promise(ok => setTimeout(ok, 300)); // 300 ms: chamadas que a tela dispara sem esperar (agenda do dia)
    }
    await Promise.all([listaClientes(), projetosAtivos()]).catch(() => { }); // listas dos formulários (nova tarefa, compromisso)
    try { localStorage.setItem(COPIA, Date.now()); } catch { }
    marcarCopia();
  } catch (e) { console.warn('cópia completa:', e.message); } finally { f.remove(); }
}

if (COPIA_MODO) {
  window.irPara = r => { history.replaceState(null, '', '#/' + r); return rotear(); };
  window.copiaPronta = rotear();
} else {
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => { });
    // deixa salvo tudo o que esta tela baixou (scripts, estilos, fontes) e o login, para abrir sem internet
    navigator.serviceWorker.ready.then(r => r.active?.postMessage({ guardar: ['login.html', 'app.html', ...performance.getEntriesByType('resource').map(x => x.name)] })).catch(() => { });
  }
  /* ---------- sem internet ---------- */
  const faixaRede = () => document.body.classList.toggle('sem-rede', !navigator.onLine);
  addEventListener('offline', faixaRede);
  // alterações feitas sem internet: envia e atualiza a tela
  const sincronizar = async () => { const n = await enviarEscritas(); if (n) { toast(`${n} alteração(ões) feita(s) sem internet foram salvas`); if (!$('#dlg').open) rotear(); } };
  addEventListener('online', async () => { faixaRede(); await sincronizar(); enviarPendentes(); copiaCompleta(); if (!$('#dlg').open) rotear(); }); // voltou: atualiza a tela com os dados novos
  faixaRede(); marcarCopia();
  setTimeout(() => { sincronizar(); enviarPendentes(); }, 3000);
  setTimeout(copiaCompleta, 10000); // depois da primeira tela, para não disputar com ela
  setInterval(() => { sincronizar(); enviarPendentes(); copiaCompleta(); }, 120000); // o evento "online" falha em alguns celulares
  rotear();
}
