// Contratos: recorrentes, avulsos e mistos. Só alerta datas; nada muda de status sozinho.
import { sb, $, main, esc, brl, hoje, diaLocal, dataBR, toast, q, rotulo, formulario, confirma, listaClientes, opcoesClientes, anexosGrandes } from './util.js';
import { enviarAoDrive, pastaDoCliente, linhaDoc } from './drive.js';
import { lancarMensalidades } from './financeiro.js';
import { criarMesDoContrato, rotuloMes } from './conteudo.js';

const TIPOS = [['recorrente', 'Recorrente'], ['avulso', 'Avulso'], ['misto', 'Misto']];
const STATUS = [['vigente', 'Vigente'], ['assinatura', 'Aguardando assinatura'], ['rascunho', 'Rascunho'], ['encerrado', 'Encerrado'], ['cancelado', 'Cancelado']];
// passagens de status permitidas (o banco confere a mesma regra: crm_contrato_trg em 024_fluxo.sql)
export const PROXIMOS = { rascunho: ['assinatura', 'vigente', 'cancelado'], assinatura: ['rascunho', 'vigente', 'cancelado'], vigente: ['encerrado', 'cancelado'], encerrado: ['vigente'], cancelado: [] };
const opcoesStatus = atual => STATUS.filter(([k]) => k === atual || PROXIMOS[atual]?.includes(k));
const COR = { vigente: 'p-aprovado', assinatura: 'p-produzindo', rascunho: 'p-a_fazer', cancelado: 'p-revisao' };
const pillStatus = s => `<span class="pill ${COR[s] || ''}">${esc(rotulo(STATUS, s))}</span>`;
const pillTipo = t => `<span class="pill p-enviado">${esc(rotulo(TIPOS, t))}</span>`;
const nomeCli = c => c ? (c.codigo ? c.codigo + ' · ' : '') + (c.empresa || c.nome) : '';
const valorTxt = c => [c.valor_mensal != null ? brl(c.valor_mensal) + '/mês' : '', c.valor_avulso != null ? brl(c.valor_avulso) : ''].filter(Boolean).join(' + ') || '—';
const dataAno = d => d ? new Date(d + 'T12:00').toLocaleDateString('pt-BR') : ''; // dd/mm/aaaa (contrato atravessa anos)
const vigencia = c => c.inicio || c.fim ? `${dataAno(c.inicio) || '?'} – ${dataAno(c.fim) || 'sem fim'}` : '—';
const diaDe = ts => new Date(ts).toLocaleDateString('sv'); // timestamptz → AAAA-MM-DD local
const dias = d => Math.round((new Date(d + 'T12:00') - new Date(hoje() + 'T12:00')) / 864e5); // >0 futuro, <0 passado
const linkOk = u => /^https?:\/\//i.test(u || '');
const nomeArq = cam => (cam || '').split('/').pop().replace(/^\d+-/, '');

// alertas de uma ficha (texto puro; quem usa escapa)
function avisos(c) {
  const a = [];
  if (c.status === 'vigente' && c.fim) { const d = dias(c.fim); a.push([d < 0 ? `venceu há ${-d} dia${d < -1 ? 's' : ''}` : d === 0 ? 'vence hoje' : `vence em ${d} dia${d > 1 ? 's' : ''}`, d <= c.aviso_dias]); }
  if (c.status === 'assinatura') { const d = -dias(diaDe(c.criado_em)); a.push([`aguardando assinatura há ${d} dia${d === 1 ? '' : 's'}`, d > 7]); }
  if (c.renovacao_auto) a.push(['renovação automática', false]);
  return a;
}

/* ---------- formulário ---------- */
const campos = (cs, atual) => [
  { k: 'cliente_id', l: 'Cliente', t: 'select', o: [['', 'Selecione…'], ...opcoesClientes(cs)], req: true },
  { k: 'titulo', l: 'Título do contrato', req: true },
  { k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS, meia: true }, { k: 'status', l: 'Status', t: 'select', o: atual ? opcoesStatus(atual) : STATUS, meia: true },
  { k: 'inicio', l: 'Início', t: 'date', meia: true }, { k: 'fim', l: 'Fim', t: 'date', meia: true },
  { k: 'valor_mensal', l: 'Valor mensal (R$)', t: 'number', meia: true }, { k: 'valor_avulso', l: 'Valor avulso (R$)', t: 'number', meia: true },
  { k: 'renovacao_auto', l: 'Renovação automática', t: 'select', o: [['false', 'Não'], ['true', 'Sim']], meia: true },
  { k: 'aviso_dias', l: 'Avisar quantos dias antes do fim', t: 'number', meia: true },
  { k: 'posts_mes', l: 'Escopo: posts por mês', t: 'number', meia: true }, { k: 'ajustes_inclusos', l: 'Rodadas de ajuste incluídas por peça', t: 'number', meia: true },
  { k: 'link_assinado', l: 'Link da assinatura (D4Sign, gov.br…)' },
  { k: 'notas', l: 'Notas', t: 'textarea', linhas: 3 }];

function valida(v) {
  if (v.tipo !== 'avulso' && v.valor_mensal == null) return 'Contrato recorrente ou misto precisa do valor mensal.';
  if (v.tipo !== 'recorrente' && v.valor_avulso == null) return 'Contrato avulso ou misto precisa do valor avulso.';
  if (v.inicio && v.fim && v.fim < v.inicio) return 'O fim não pode ser antes do início.';
  if (v.link_assinado && !linkOk(v.link_assinado)) return 'O link da assinatura precisa começar com https://';
  return null;
}

// abre o formulário até os dados estarem válidos; null = cancelou (ou botão extra, ver returnValue)
async function pedir(titulo, val, extra = '', atual = null) {
  const cs = await listaClientes();
  if (!cs.length) { toast('Cadastre um cliente primeiro', true); return null; }
  for (let erro = null; ;) {
    const v = await formulario(titulo, campos(cs, atual), val, (erro ? `<p class="atrasado">${esc(erro)}</p>` : '') + extra);
    if (!v) return null;
    v.renovacao_auto = v.renovacao_auto === 'true';
    v.aviso_dias = Math.max(0, Math.round(v.aviso_dias ?? 30));
    v.posts_mes = v.posts_mes ? Math.max(1, Math.round(v.posts_mes)) : null; // colunas inteiras
    v.ajustes_inclusos = v.ajustes_inclusos == null ? null : Math.round(v.ajustes_inclusos);
    if (v.tipo === 'avulso') v.valor_mensal = null; // guarda só o valor que vale para o tipo
    if (v.tipo === 'recorrente') v.valor_avulso = null;
    erro = valida(v); if (!erro) return v;
    val = v;
  }
}

/* ---------- escopo: quanto do contratado já foi usado em cada mês ---------- */
const mensal = c => c.tipo !== 'avulso' && !!c.posts_mes; // contrato que vira um projeto por mês
export const mesAtual = () => hoje().slice(0, 7);
export const mesSeguinte = (m = mesAtual()) => { const [a, n] = m.split('-').map(Number); return n === 12 ? `${a + 1}-01` : `${a}-${String(n + 1).padStart(2, '0')}`; };
// posts = peças das etapas que o cliente aprova (as "só consulta" não contam); além = ajustes acima do incluído, somados por peça
export function usoEscopo(c, projeto) {
  const ps = projeto.crm_etapas.filter(e => !e.consulta).flatMap(e => e.crm_entregas);
  return { posts: ps.length, aprovados: ps.filter(x => x.status === 'aprovado').length, previstos: c.posts_mes,
    alem: c.ajustes_inclusos == null ? 0 : ps.reduce((s, x) => s + Math.max(0, (x.revisoes || 0) - c.ajustes_inclusos), 0) };
}
export const textoUso = u => [u.previstos ? `${u.posts} de ${u.previstos} posts` : `${u.posts} posts`, `${u.aprovados} aprovados`, u.alem ? `${u.alem} ajuste${u.alem > 1 ? 's' : ''} além do combinado` : ''].filter(Boolean).join(' · ');
// meses que já deviam existir: o atual (depois do início) e, a partir do dia 20, o seguinte (até o fim do contrato)
export function mesesQueFaltam(c, feitos) {
  if (c.status !== 'vigente' || !mensal(c)) return [];
  const ms = [mesAtual(), ...(+hoje().slice(8) >= 20 ? [mesSeguinte()] : [])];
  return ms.filter(m => !feitos.includes(m) && (!c.inicio || c.inicio.slice(0, 7) <= m) && (!c.fim || c.fim.slice(0, 7) >= m));
}
async function cartaoEscopo(c) {
  const ps = await q(sb.from('crm_projetos').select('id,nome,mes,status,crm_etapas(consulta,crm_entregas(status,revisoes))').eq('contrato_id', c.id).order('mes', { ascending: false }));
  const meses = ps.filter(p => p.mes), faltam = mesesQueFaltam(c, meses.map(p => p.mes));
  return `<section class="card" style="margin-top:18px"><h3>Escopo</h3>
    <p class="mute" style="margin:0 0 10px">${[c.posts_mes ? `${c.posts_mes} posts por mês` : '', c.ajustes_inclusos != null ? `${c.ajustes_inclusos} rodada(s) de ajuste por peça` : ''].filter(Boolean).join(' · ')}</p>
    <ul class="lista">${meses.map(p => { const u = usoEscopo(c, p); return `<li><a class="cresce" href="#/projeto/${esc(p.id)}"><b>${esc(rotuloMes(p.mes))}</b><small>${textoUso(u)}</small></a>${u.alem || (u.previstos && u.posts > u.previstos) ? '<span class="pill p-revisao">acima do contrato</span>' : ''}</li>`; }).join('')
      || '<li class="vazio">Nenhum mês criado ainda.</li>'}</ul>
    ${faltam.map(m => `<button class="bt peq sec" data-criar-mes="${m}">Criar ${esc(rotuloMes(m))}</button>`).join(' ')}</section>`;
}

/* ---------- lista: #/contratos ---------- */
export async function contratos() {
  const cs = await q(sb.from('crm_contratos').select('*,crm_clientes(id,codigo,nome,empresa)').order('fim', { ascending: true, nullsFirst: false }));
  const vig = cs.filter(c => c.status === 'vigente'), em60 = diaLocal(60);
  const mrr = vig.reduce((s, c) => s + (Number(c.valor_mensal) || 0), 0);
  const aVencer = vig.filter(c => c.fim && c.fim <= em60), vencidos = aVencer.filter(c => c.fim < hoje()).length;
  const linha = c => `<tr data-id="${esc(c.id)}" style="cursor:pointer"><td><b>${esc(nomeCli(c.crm_clientes))}</b><br><small class="mute">${esc(c.titulo)}</small></td>
    <td>${pillTipo(c.tipo)}</td><td class="${c.status === 'vigente' && c.fim && c.fim < hoje() ? 'atrasado' : ''}">${vigencia(c)}</td><td class="dir">${valorTxt(c)}</td></tr>`;
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Contratos</h1><p>Os alertas avisam das datas; o status só muda quando você muda.</p></div>
    <button class="bt" id="nContr">+ Contrato</button></div>
    <div class="grade" style="margin-bottom:18px">
      <div class="card kpi"><div class="rot">Receita recorrente</div><div class="num">${brl(mrr)}</div><small class="mute">por mês, contratos vigentes</small></div>
      <div class="card kpi"><div class="rot">Vigentes</div><div class="num">${vig.length}</div></div>
      <div class="card kpi"><div class="rot">Vencem em 60 dias</div><div class="num ${vencidos ? 'atrasado' : ''}">${aVencer.length}</div>${vencidos ? `<small class="atrasado">${vencidos} já venceu</small>` : ''}</div></div>
    ${STATUS.map(([k, l]) => { const g = cs.filter(c => c.status === k); return g.length ? `<h2 style="margin:8px 0 12px">${l}</h2>
      <div class="card" style="margin-bottom:22px"><table><thead><tr><th>Cliente</th><th>Tipo</th><th>Vigência</th><th class="dir">Valor</th></tr></thead><tbody>${g.map(linha).join('')}</tbody></table></div>` : ''; }).join('')
    || '<p class="vazio">Nenhum contrato ainda.</p>'}`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/contrato/' + tr.dataset.id);
  $('#nContr').onclick = () => novoContrato();
}

/* ---------- ficha: #/contrato/<id> ---------- */
export async function contrato(id) {
  const [c] = await q(sb.from('crm_contratos').select('*,crm_clientes(id,codigo,nome,empresa,drive_pasta,drive_subpastas),crm_propostas!crm_contratos_proposta_id_fkey(id,titulo,versao),crm_projetos!crm_contratos_projeto_id_fkey(id,nome)').eq('id', id));
  if (!c) { main.innerHTML = '<p class="vazio">Contrato não encontrado.</p>'; return; }
  const cli = c.crm_clientes, prop = c.crm_propostas, proj = c.crm_projetos;
  const arqUrl = c.arquivo ? (await sb.storage.from('crm-anexos').createSignedUrl(c.arquivo, 3600)).data?.signedUrl : null;
  const docs = await q(sb.from('crm_documentos').select('*').eq('contrato_id', id).order('criado_em', { ascending: false }));
  const lanc = await q(sb.from('crm_parcelas').select('valor,pago_em').eq('contrato_id', id).eq('tipo', 'receita'));
  const lancTot = lanc.reduce((s, x) => s + +x.valor, 0), lancRec = lanc.filter(x => x.pago_em).reduce((s, x) => s + +x.valor, 0);
  const al = avisos(c);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/contratos">Contratos</a> · <a href="#/cliente/${esc(cli.id)}">${esc(nomeCli(cli))}</a></div><h1>${esc(c.titulo)}</h1>
      <p>${pillTipo(c.tipo)} ${pillStatus(c.status)}${al.map(([t, forte]) => ` · <span class="${forte ? 'atrasado' : ''}">${esc(t)}</span>`).join('')}</p></div>
    <div class="acoes"><select id="st" class="busca" style="min-width:0">${opcoesStatus(c.status).map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${proj || mensal(c) ? '' : '<button class="bt sec" id="nProj">Criar projeto</button>'}<button class="bt sec" id="lancar">Lançar no financeiro</button><button class="bt sec" id="ed">Editar</button></div></div>
  <div class="grade2">
    <section class="card"><h3>Dados</h3><ul class="lista">
      ${[['Cliente', `<a href="#/cliente/${esc(cli.id)}">${esc(nomeCli(cli))}</a>`], ['Tipo', esc(rotulo(TIPOS, c.tipo))], ['Vigência', vigencia(c)],
        ['Valor mensal', c.valor_mensal != null ? brl(c.valor_mensal) : ''], ['Valor avulso', c.valor_avulso != null ? brl(c.valor_avulso) : ''],
        ['Renovação', c.renovacao_auto ? 'Automática' : 'Manual'], ['Aviso', `${c.aviso_dias} dias antes do fim`],
        ['Proposta', prop ? `<a href="#/proposta/${esc(prop.id)}">${esc(prop.titulo)} · v${esc(prop.versao)}</a>` : ''],
        ['Projeto', proj ? `<a href="#/projeto/${esc(proj.id)}">${esc(proj.nome)}</a>` : ''],
        ['Financeiro', lanc.length ? `<a href="#/financeiro">${brl(lancTot)} lançado · ${brl(lancRec)} recebido · ${brl(Math.round((lancTot - lancRec) * 100) / 100)} em aberto</a>` : ''], ['Criado em', dataBR(diaDe(c.criado_em))]]
        .filter(x => x[1]).map(([l, v]) => `<li><span class="mute" style="min-width:110px">${l}</span><span>${v}</span></li>`).join('')}</ul>
      ${c.notas ? `<p style="white-space:pre-wrap">${esc(c.notas)}</p>` : ''}</section>
    <section class="card"><h3>Assinatura</h3><ul class="lista">
      <li><div class="cresce"><b>Link para assinar</b><small>${linkOk(c.link_assinado) ? `<a href="${esc(c.link_assinado)}" target="_blank" rel="noopener">${esc(c.link_assinado)}</a>` : 'Nenhum link (D4Sign, gov.br…)'}</small></div><button class="bt peq fantasma" id="link">${c.link_assinado ? 'Trocar' : 'Adicionar'}</button></li>
      <li><div class="cresce"><b>Contrato assinado</b><small>${arqUrl ? `<a href="${esc(arqUrl)}" target="_blank" rel="noopener">${esc(nomeArq(c.arquivo))}</a>` : 'Nenhum arquivo anexado.'}</small></div>
        <label class="bt peq sec" style="cursor:pointer">${c.arquivo ? 'Substituir' : 'Anexar'}<input type="file" id="arq" hidden></label></li>
      <li><div class="cresce"><b>No Drive</b><small>${docs.length ? 'Cópias na pasta do cliente:' : 'Nenhum arquivo enviado ao Drive.'}</small></div><button class="bt peq sec" id="envDrive">Enviar ao Drive</button></li>
      ${docs.map(linhaDoc).join('')}</ul></section>
  </div>
  ${mensal(c) || c.ajustes_inclusos != null ? await cartaoEscopo(c) : ''}`;
  main.querySelectorAll('[data-criar-mes]').forEach(b => b.onclick = async () => { b.disabled = true; try { location.hash = '#/projeto/' + await criarMesDoContrato({ ...c, crm_clientes: cli }, b.dataset.criarMes); } catch { b.disabled = false; } });
  $('#st').onchange = async e => {
    const st = e.target.value;
    if (['cancelado', 'encerrado'].includes(st) && !await confirma(st === 'cancelado' ? `Cancelar “${c.titulo}”? Contrato cancelado não volta a vigente.` : `Encerrar “${c.titulo}”?`)) return contrato(id);
    try { await q(sb.from('crm_contratos').update({ status: st }).eq('id', id)); toast('Status atualizado'); } catch { }
    contrato(id);
  };
  $('#lancar').onclick = async () => { if (await lancarMensalidades(c)) contrato(id); };
  $('#ed').onclick = async () => {
    const v = await pedir('Editar contrato', c, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar contrato</button>', c.status);
    if ($('#dlg').returnValue === 'apagar') {
      if (await confirma(`Apagar o contrato “${c.titulo}”?`)) {
        await q(sb.from('crm_contratos').delete().eq('id', id));
        if (c.arquivo) await sb.storage.from('crm-anexos').remove([c.arquivo]);
        toast('Contrato apagado'); location.hash = '#/contratos';
      }
      return;
    }
    if (v) { await q(sb.from('crm_contratos').update(v).eq('id', id)); toast('Salvo'); contrato(id); }
  };
  $('#link').onclick = async () => {
    let erro = '';
    for (; ;) {
      const v = await formulario('Link da assinatura', [{ k: 'link_assinado', l: 'Link (D4Sign, gov.br…). Vazio = remover' }], c, erro && `<p class="atrasado">${esc(erro)}</p>`);
      if (!v) return;
      if (v.link_assinado && !linkOk(v.link_assinado)) { erro = 'O link precisa começar com https://'; continue; }
      await q(sb.from('crm_contratos').update(v).eq('id', id)); toast('Link salvo'); return contrato(id);
    }
  };
  $('#arq').onchange = async e => {
    const f = e.target.files[0]; if (!f) return;
    if (anexosGrandes([f])) { e.target.value = ''; return; }
    const caminho = `contratos/${id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
    toast('Enviando ' + f.name + '…');
    await q(sb.storage.from('crm-anexos').upload(caminho, f));
    await q(sb.from('crm_contratos').update({ arquivo: caminho }).eq('id', id));
    if (c.arquivo) await sb.storage.from('crm-anexos').remove([c.arquivo]); // substituiu: tira o antigo
    toast('Contrato anexado'); contrato(id);
  };
  $('#envDrive').onclick = async () => {
    try {
      if (!cli.drive_pasta && !await pastaDoCliente(cli)) return;
      if (!await formulario('Enviar ao Drive', [], {}, '<p class="mute">Normalmente o PDF do contrato assinado.</p><label>Arquivo<input type="file" id="contrDrive" required></label>', 'Enviar')) return;
      const arquivo = $('#contrDrive').files[0]; if (!arquivo) return; // o diálogo continua no DOM depois de fechar
      await enviarAoDrive({ cliente: cli, arquivo, tipo: 'CONTRATO', subpasta: '03', vinculo: { contrato_id: c.id }, classificacao: 'confidencial' });
      contrato(id);
    } catch (e) { toast(e.message, true); }
  };
  if ($('#nProj')) $('#nProj').onclick = () => dispatchEvent(new CustomEvent('crm:criar-projeto', { detail: { cliente_id: c.cliente_id, nome: c.titulo, valor: c.valor_avulso ?? c.valor_mensal, contrato_id: id } }));
}

/* ---------- novo (também chamado pelas propostas aprovadas) ---------- */
export async function novoContrato(val = {}) {
  const tipo = val.valor_mensal != null ? (val.valor_avulso != null ? 'misto' : 'recorrente') : 'avulso';
  const v = await pedir('Novo contrato', { tipo, inicio: hoje(), aviso_dias: 30, status: 'assinatura', renovacao_auto: false, ...val });
  if (!v) return null;
  const [c] = await q(sb.from('crm_contratos').insert({ ...v, proposta_id: val.proposta_id ?? null }).select('id'));
  toast('Contrato criado'); location.hash = '#/contrato/' + c.id;
  return c.id;
}

/* ---------- alertas para a tela Início (texto puro: escape ao exibir) ---------- */
export async function alertasContratos() {
  const cs = await q(sb.from('crm_contratos').select('id,titulo,status,fim,aviso_dias,criado_em,crm_clientes(codigo,nome,empresa)').in('status', ['vigente', 'assinatura']));
  const h = hoje(), out = [];
  for (const c of cs) {
    const sub = `${nomeCli(c.crm_clientes)} · ${c.titulo}`, href = '#/contrato/' + c.id;
    if (c.status === 'vigente' && c.fim && dias(c.fim) <= c.aviso_dias) out.push({ titulo: c.fim < h ? 'Contrato venceu' : 'Contrato vence', sub, data: c.fim, href, atrasado: c.fim < h });
    if (c.status === 'assinatura') { const d = diaDe(c.criado_em); if (dias(d) < -7) out.push({ titulo: 'Aguardando assinatura', sub, data: d, href, atrasado: true }); }
  }
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

/* ---------- bloco para a ficha do cliente ---------- */
export async function contratosDoCliente(clienteId) {
  const cs = await q(sb.from('crm_contratos').select('id,titulo,tipo,status,valor_mensal,valor_avulso').eq('cliente_id', clienteId).order('criado_em', { ascending: false }));
  return `<section class="card"><h3>Contratos</h3><ul class="lista">${cs.map(c => `<li><a class="cresce" href="#/contrato/${esc(c.id)}"><b>${esc(c.titulo)}</b><small>${esc(rotulo(TIPOS, c.tipo))} · ${valorTxt(c)}</small></a>${pillStatus(c.status)}</li>`).join('') || '<li class="vazio">Nenhum contrato.</li>'}</ul>
    <button class="bt peq sec" data-novo-contrato="${esc(clienteId)}">+ Contrato</button></section>`;
}
