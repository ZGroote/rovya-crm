// Contratos: recorrentes, avulsos e mistos. Só alerta datas; nada muda de status sozinho.
import { sb, $, main, esc, brl, hoje, diaLocal, dataBR, toast, q, rotulo, formulario, confirma, listaClientes, opcoesClientes } from './util.js';

const TIPOS = [['recorrente', 'Recorrente'], ['avulso', 'Avulso'], ['misto', 'Misto']];
const STATUS = [['vigente', 'Vigente'], ['assinatura', 'Aguardando assinatura'], ['rascunho', 'Rascunho'], ['encerrado', 'Encerrado'], ['cancelado', 'Cancelado']];
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
const campos = cs => [
  { k: 'cliente_id', l: 'Cliente', t: 'select', o: [['', 'Selecione…'], ...opcoesClientes(cs)], req: true },
  { k: 'titulo', l: 'Título do contrato', req: true },
  { k: 'tipo', l: 'Tipo', t: 'select', o: TIPOS, meia: true }, { k: 'status', l: 'Status', t: 'select', o: STATUS, meia: true },
  { k: 'inicio', l: 'Início', t: 'date', meia: true }, { k: 'fim', l: 'Fim', t: 'date', meia: true },
  { k: 'valor_mensal', l: 'Valor mensal (R$)', t: 'number', meia: true }, { k: 'valor_avulso', l: 'Valor avulso (R$)', t: 'number', meia: true },
  { k: 'renovacao_auto', l: 'Renovação automática', t: 'select', o: [['false', 'Não'], ['true', 'Sim']], meia: true },
  { k: 'aviso_dias', l: 'Avisar quantos dias antes do fim', t: 'number', meia: true },
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
async function pedir(titulo, val, extra = '') {
  const cs = await listaClientes();
  if (!cs.length) { toast('Cadastre um cliente primeiro', true); return null; }
  for (let erro = null; ;) {
    const v = await formulario(titulo, campos(cs), val, (erro ? `<p class="atrasado">${esc(erro)}</p>` : '') + extra);
    if (!v) return null;
    v.renovacao_auto = v.renovacao_auto === 'true';
    v.aviso_dias = Math.max(0, Math.round(v.aviso_dias ?? 30));
    if (v.tipo === 'avulso') v.valor_mensal = null; // guarda só o valor que vale para o tipo
    if (v.tipo === 'recorrente') v.valor_avulso = null;
    erro = valida(v); if (!erro) return v;
    val = v;
  }
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
  const [c] = await q(sb.from('crm_contratos').select('*,crm_clientes(id,codigo,nome,empresa),crm_propostas!crm_contratos_proposta_id_fkey(id,titulo,versao),crm_projetos!crm_contratos_projeto_id_fkey(id,nome)').eq('id', id));
  if (!c) { main.innerHTML = '<p class="vazio">Contrato não encontrado.</p>'; return; }
  const cli = c.crm_clientes, prop = c.crm_propostas, proj = c.crm_projetos;
  const arqUrl = c.arquivo ? (await sb.storage.from('crm-anexos').createSignedUrl(c.arquivo, 3600)).data?.signedUrl : null;
  const al = avisos(c);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/contratos">Contratos</a> · <a href="#/cliente/${esc(cli.id)}">${esc(nomeCli(cli))}</a></div><h1>${esc(c.titulo)}</h1>
      <p>${pillTipo(c.tipo)} ${pillStatus(c.status)}${al.map(([t, forte]) => ` · <span class="${forte ? 'atrasado' : ''}">${esc(t)}</span>`).join('')}</p></div>
    <div class="acoes"><select id="st" class="busca" style="min-width:0">${STATUS.map(([k, l]) => `<option value="${k}" ${k === c.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${proj ? '' : '<button class="bt sec" id="nProj">Criar projeto</button>'}<button class="bt sec" id="ed">Editar</button></div></div>
  <div class="grade2">
    <section class="card"><h3>Dados</h3><ul class="lista">
      ${[['Cliente', `<a href="#/cliente/${esc(cli.id)}">${esc(nomeCli(cli))}</a>`], ['Tipo', esc(rotulo(TIPOS, c.tipo))], ['Vigência', vigencia(c)],
        ['Valor mensal', c.valor_mensal != null ? brl(c.valor_mensal) : ''], ['Valor avulso', c.valor_avulso != null ? brl(c.valor_avulso) : ''],
        ['Renovação', c.renovacao_auto ? 'Automática' : 'Manual'], ['Aviso', `${c.aviso_dias} dias antes do fim`],
        ['Proposta', prop ? `<a href="#/proposta/${esc(prop.id)}">${esc(prop.titulo)} · v${esc(prop.versao)}</a>` : ''],
        ['Projeto', proj ? `<a href="#/projeto/${esc(proj.id)}">${esc(proj.nome)}</a>` : ''], ['Criado em', dataBR(diaDe(c.criado_em))]]
        .filter(x => x[1]).map(([l, v]) => `<li><span class="mute" style="min-width:110px">${l}</span><span>${v}</span></li>`).join('')}</ul>
      ${c.notas ? `<p style="white-space:pre-wrap">${esc(c.notas)}</p>` : ''}</section>
    <section class="card"><h3>Assinatura</h3><ul class="lista">
      <li><div class="cresce"><b>Link para assinar</b><small>${linkOk(c.link_assinado) ? `<a href="${esc(c.link_assinado)}" target="_blank" rel="noopener">${esc(c.link_assinado)}</a>` : 'Nenhum link (D4Sign, gov.br…)'}</small></div><button class="bt peq fantasma" id="link">${c.link_assinado ? 'Trocar' : 'Adicionar'}</button></li>
      <li><div class="cresce"><b>Contrato assinado</b><small>${arqUrl ? `<a href="${esc(arqUrl)}" target="_blank" rel="noopener">${esc(nomeArq(c.arquivo))}</a>` : 'Nenhum arquivo anexado.'}</small></div>
        <label class="bt peq sec" style="cursor:pointer">${c.arquivo ? 'Substituir' : 'Anexar'}<input type="file" id="arq" hidden></label></li></ul></section>
  </div>`;
  $('#st').onchange = async e => { await q(sb.from('crm_contratos').update({ status: e.target.value }).eq('id', id)); toast('Status atualizado'); contrato(id); };
  $('#ed').onclick = async () => {
    const v = await pedir('Editar contrato', c, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar contrato</button>');
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
    const caminho = `contratos/${id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
    toast('Enviando ' + f.name + '…');
    await q(sb.storage.from('crm-anexos').upload(caminho, f));
    await q(sb.from('crm_contratos').update({ arquivo: caminho }).eq('id', id));
    if (c.arquivo) await sb.storage.from('crm-anexos').remove([c.arquivo]); // substituiu: tira o antigo
    toast('Contrato anexado'); contrato(id);
  };
  if (!proj) $('#nProj').onclick = () => dispatchEvent(new CustomEvent('crm:criar-projeto', { detail: { cliente_id: c.cliente_id, nome: c.titulo, valor: c.valor_avulso ?? c.valor_mensal, contrato_id: id } }));
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
