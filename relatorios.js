// Relatórios e Inteligência: indicadores comerciais, financeiros (regime de caixa) e de operação por período, com exportação CSV.
// Tudo é calculado no navegador a partir das tabelas crm_* (dataset pequeno).
import { sb, $, main, esc, brl, hoje, venceu, q, listaClientes, baixarCsv } from './util.js';

const PERIODOS = [['mes', 'Este mês'], ['passado', 'Mês passado'], ['tri', 'Trimestre'], ['ano', 'Ano'], ['pers', 'Personalizado']];
const TIPOS_LEAD = { receptivo: 'Receptivo', ativo: 'Ativo' };
let periodo = 'mes', pers = { ini: '', fim: '' }; // escolha fica na memória enquanto a aba estiver aberta

const r2 = x => Math.round(x * 100) / 100;
const somaPor = (l, f) => r2(l.reduce((s, x) => s + (+f(x) || 0), 0));
const soma = l => somaPor(l, x => x.valor);
const dia = ts => ts ? new Date(ts).toLocaleDateString('sv') : ''; // timestamptz → AAAA-MM-DD no fuso local
const dataNum = d => d ? d.split('-').reverse().join('/') : '';
// [[chave, total]] ordenado do maior para o menor; val padrão = contar
const agrupar = (l, chave, val = () => 1) => Object.entries(l.reduce((m, x) => { const k = chave(x); m[k] = (m[k] || 0) + val(x); return m; }, {}))
  .map(([k, v]) => [k, r2(v)]).sort((a, b) => b[1] - a[1]);

function intervalo() {
  const d = new Date(), a = d.getFullYear(), m = d.getMonth(), f = (y, mm, dd) => new Date(y, mm, dd).toLocaleDateString('sv');
  if (periodo === 'passado') return [f(a, m - 1, 1), f(a, m, 0)];
  if (periodo === 'tri') { const t = m - m % 3; return [f(a, t, 1), f(a, t + 3, 0)]; }
  if (periodo === 'ano') return [f(a, 0, 1), f(a, 11, 31)];
  if (periodo === 'pers') { const i = pers.ini || f(a, m, 1), fi = pers.fim || hoje(); return i <= fi ? [i, fi] : [fi, i]; }
  return [f(a, m, 1), f(a, m + 1, 0)];
}

const FMT = { n: v => String(v), r: brl, p: v => v == null ? '—' : (v * 100).toFixed(1).replace('.', ',') + '%' };
const FMT_CSV = { n: v => String(v), r: v => (+v).toFixed(2).replace('.', ','), p: FMT.p };

export async function relatorios() {
  const [ini, fim] = intervalo(), h = hoje();
  const noPer = d => !!d && d >= ini && d <= fim;
  const [ops, props, conts, parcs, projs, ents, tars, cls] = await Promise.all([
    q(sb.from('crm_oportunidades').select('etapa,valor,tipo_lead,motivo_perda,criado_em,atualizado_em,fechado_em,crm_clientes(origem)')),
    q(sb.from('crm_propostas').select('grupo,versao,status,valor,enviada_em')),
    q(sb.from('crm_contratos').select('tipo,status,valor_mensal,inicio,fim')),
    q(sb.from('crm_parcelas').select('tipo,categoria,valor,vencimento,pago_em,cliente_id,crm_projetos(cliente_id)')),
    q(sb.from('crm_projetos').select('status')),
    q(sb.from('crm_entregas').select('status,prazo,atualizado_em')),
    q(sb.from('crm_tarefas').select('status,prazo,concluida_em')),
    listaClientes()]);

  /* ---------- Comercial ---------- */
  const criadas = ops.filter(o => noPer(dia(o.criado_em)));
  const fechadas = ops.filter(o => noPer(dia(o.fechado_em || o.atualizado_em))); // fechado_em: gravado ao ir para Fechado/Perdido
  const ganhas = fechadas.filter(o => o.etapa === 'ganho'), perdidas = fechadas.filter(o => o.etapa === 'perdido');
  const valorGanho = soma(ganhas);
  const conversao = ganhas.length + perdidas.length ? ganhas.length / (ganhas.length + perdidas.length) : null;
  const porTipo = agrupar(criadas, o => TIPOS_LEAD[o.tipo_lead] || o.tipo_lead || '—');
  const porOrigem = agrupar(criadas, o => o.crm_clientes?.origem?.trim() || 'Sem origem');
  const motivos = agrupar(perdidas, o => o.motivo_perda?.trim() || 'Sem motivo informado');
  const ultima = props.reduce((m, p) => m.set(p.grupo, Math.max(m.get(p.grupo) || 0, p.versao)), new Map());
  const enviadas = props.filter(p => p.versao === ultima.get(p.grupo) && noPer(p.enviada_em));
  const aprovadas = enviadas.filter(p => p.status === 'aprovada');

  /* ---------- Financeiro (caixa) ---------- */
  const pagas = parcs.filter(x => noPer(x.pago_em));
  const rec = pagas.filter(x => x.tipo !== 'despesa'), desp = pagas.filter(x => x.tipo === 'despesa');
  const receitas = soma(rec), despesas = soma(desp);
  const vigentes = conts.filter(c => c.status === 'vigente' && c.tipo !== 'avulso' && (!c.inicio || c.inicio <= h) && (!c.fim || c.fim >= h));
  const mrr = somaPor(vigentes, c => c.valor_mensal);
  const cliPorId = new Map(cls.map(c => [c.id, c]));
  const porCliente = agrupar(rec, x => x.cliente_id || x.crm_projetos?.cliente_id || '', x => +x.valor)
    .map(([id, v]) => { const c = cliPorId.get(id); return [c?.codigo || '', c ? c.empresa || c.nome : 'Sem cliente', v, id]; });
  const despCat = agrupar(desp, x => x.categoria || 'Outros', x => +x.valor);
  const aberto = parcs.filter(x => x.tipo !== 'despesa' && !x.pago_em), atrasado = aberto.filter(x => venceu(x.vencimento));

  /* ---------- Operação ---------- */
  const entAprov = ents.filter(e => e.status === 'aprovado' && noPer(dia(e.atualizado_em)));
  const tarConc = tars.filter(t => noPer(t.concluida_em));
  const projAtivos = projs.filter(p => p.status === 'ativo');
  const entAtras = ents.filter(e => e.status !== 'aprovado' && venceu(e.prazo));
  const tarAtras = tars.filter(t => t.status !== 'feita' && venceu(t.prazo));

  // [seção, indicador, valor, formato, nota]: alimenta os cartões e o CSV
  const IND = [
    ['Comercial', 'Oportunidades criadas', criadas.length, 'n'],
    ['Comercial', 'Ganhas', ganhas.length, 'n'],
    ['Comercial', 'Perdidas', perdidas.length, 'n'],
    ['Comercial', 'Taxa de conversão', conversao, 'p', 'ganhas ÷ (ganhas + perdidas)'],
    ['Comercial', 'Valor ganho', valorGanho, 'r'],
    ['Comercial', 'Ticket médio', ganhas.length ? r2(valorGanho / ganhas.length) : 0, 'r'],
    ['Comercial', 'Propostas enviadas', enviadas.length, 'n', 'última versão de cada proposta'],
    ['Comercial', 'Propostas aprovadas', aprovadas.length, 'n', brl(soma(aprovadas))],
    ['Financeiro', 'Receitas recebidas', receitas, 'r'],
    ['Financeiro', 'Despesas pagas', despesas, 'r'],
    ['Financeiro', 'Resultado', r2(receitas - despesas), 'r'],
    ['Financeiro', 'Receita recorrente mensal (atual)', mrr, 'r', `${vigentes.length} contrato(s) vigente(s)`],
    ['Financeiro', 'A receber em aberto (atual)', soma(aberto), 'r', `${aberto.length} lançamento(s)`],
    ['Financeiro', 'Atrasado (atual)', soma(atrasado), 'r', `${atrasado.length} lançamento(s)`],
    ['Operação', 'Entregas aprovadas', entAprov.length, 'n'],
    ['Operação', 'Tarefas concluídas', tarConc.length, 'n'],
    ['Operação', 'Projetos ativos (agora)', projAtivos.length, 'n'],
    ['Operação', 'Entregas atrasadas (agora)', entAtras.length, 'n'],
    ['Operação', 'Tarefas atrasadas (agora)', tarAtras.length, 'n']];
  const DETALHE = [
    ...porTipo.map(([k, v]) => ['Comercial', 'Oportunidades por tipo de lead: ' + k, v, 'n']),
    ...porOrigem.map(([k, v]) => ['Comercial', 'Oportunidades por origem: ' + k, v, 'n']),
    ...motivos.map(([k, v]) => ['Comercial', 'Motivo de perda: ' + k, v, 'n']),
    ...despCat.map(([k, v]) => ['Financeiro', 'Despesa por categoria: ' + k, v, 'r']),
    ...porCliente.map(([cod, nome, v]) => ['Financeiro', 'Receita por cliente: ' + (cod ? cod + ' · ' : '') + nome, v, 'r'])];

  const kpis = sec => `<div class="grade" style="margin-bottom:18px">${IND.filter(i => i[0] === sec).map(([, rot, v, f, nota]) => `<div class="card kpi"><div class="rot">${esc(rot)}</div>
    <div class="num ${(rot === 'Resultado' && v < 0) || (/atrasad/i.test(rot) && v > 0) ? 'atrasado' : ''}">${esc(FMT[f](v))}</div>${nota ? `<small class="mute">${esc(nota)}</small>` : ''}</div>`).join('')}</div>`;
  const barras = (l, f, vazio) => {
    const max = Math.max(...l.map(x => x[1]), 1);
    return l.length ? `<div style="display:grid;gap:10px">${l.map(([k, v]) => `<div><div style="display:flex;justify-content:space-between;gap:10px;font-size:.88rem;margin-bottom:3px"><span>${esc(k)}</span><b>${esc(f(v))}</b></div>
      <div class="barra"><i style="width:${100 * v / max}%"></i></div></div>`).join('')}</div>` : `<p class="vazio">${vazio}</p>`;
  };
  const card = (tit, corpo) => `<section class="card"><h3>${tit}</h3>${corpo}</section>`;
  const top = porCliente.slice(0, 10), maxCli = Math.max(...top.map(x => x[2]), 1);

  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Inteligência</div><h1>Relatórios</h1><p>${dataNum(ini)} a ${dataNum(fim)}</p></div>
      <div class="acoes"><button class="bt sec" id="csvCli">Receita por cliente (CSV)</button><button class="bt" id="csv">Exportar CSV</button></div></div>
    <div class="tabs" style="overflow-x:auto">${PERIODOS.map(([k, l]) => `<button data-p="${k}" class="${k === periodo ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${periodo === 'pers' ? `<div class="acoes" style="align-items:center;margin-bottom:18px"><label>De <input type="date" id="pIni" class="busca" style="min-width:0" value="${esc(ini)}"></label>
      <label>até <input type="date" id="pFim" class="busca" style="min-width:0" value="${esc(fim)}"></label></div>` : ''}

    <h2 style="margin:8px 0 12px">Comercial</h2>${kpis('Comercial')}
    <div class="grade2" style="margin-bottom:26px">
      ${card('Oportunidades por tipo de lead', barras(porTipo, FMT.n, 'Nenhuma oportunidade criada no período.'))}
      ${card('Oportunidades por origem', barras(porOrigem, FMT.n, 'Nenhuma oportunidade criada no período.'))}
      ${card('Principais motivos de perda', barras(motivos.slice(0, 5), FMT.n, 'Nenhuma perda no período.'))}</div>

    <h2 style="margin:8px 0 12px">Financeiro <small class="mute" style="font-size:.8rem">regime de caixa</small></h2>${kpis('Financeiro')}
    <div class="grade2" style="margin-bottom:26px">
      ${card('Receita por cliente', top.length ? `<table><thead><tr><th>Código</th><th>Cliente</th><th class="dir">Recebido</th><th style="width:30%"></th></tr></thead><tbody>
        ${top.map(([cod, nome, v, id]) => `<tr><td>${esc(cod)}</td><td>${id ? `<a href="#/cliente/${esc(id)}">${esc(nome)}</a>` : esc(nome)}</td><td class="dir">${brl(v)}</td>
          <td><div class="barra"><i style="width:${100 * v / maxCli}%"></i></div></td></tr>`).join('')}</tbody></table>
        ${porCliente.length > 10 ? `<small class="mute">Top 10 de ${porCliente.length}. O CSV traz todos.</small>` : ''}` : '<p class="vazio">Nenhuma receita recebida no período.</p>')}
      ${card('Despesas por categoria', barras(despCat, brl, 'Nenhuma despesa paga no período.'))}</div>

    <h2 style="margin:8px 0 12px">Operação</h2>${kpis('Operação')}`;

  main.querySelectorAll('[data-p]').forEach(b => b.onclick = () => {
    if (b.dataset.p === 'pers' && periodo !== 'pers') pers = { ini, fim }; // começa do período que estava na tela
    periodo = b.dataset.p; relatorios();
  });
  if (periodo === 'pers') {
    $('#pIni').onchange = e => { if (e.target.value) { pers.ini = e.target.value; relatorios(); } };
    $('#pFim').onchange = e => { if (e.target.value) { pers.fim = e.target.value; relatorios(); } };
  }
  const sufixo = `${ini}-a-${fim}.csv`;
  $('#csv').onclick = () => baixarCsv([['Seção', 'Indicador', 'Valor'], ['Período', 'De', dataNum(ini)], ['Período', 'Até', dataNum(fim)],
    ...[...IND, ...DETALHE].map(([s, i, v, f]) => [s, i, FMT_CSV[f](v)])], 'relatorio-' + sufixo);
  $('#csvCli').onclick = () => baixarCsv([['Código', 'Cliente', 'Recebido'], ...porCliente.map(([cod, nome, v]) => [cod, nome, FMT_CSV.r(v)])], 'receita-por-cliente-' + sufixo);
}
