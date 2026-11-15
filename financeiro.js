// Financeiro: livro de lançamentos (receitas e despesas), com ou sem projeto.
// Fluxo: contrato/serviço → lançamento → cobrança externa → confirmação manual (Recebi/Paguei) → relatório. Nada muda sozinho.
import { sb, $, main, esc, brl, hoje, diaLocal, dataBR, venceu, toast, q, formulario, listaClientes, opcoesClientes } from './util.js';

const CATEGORIAS = {
  receita: ['Projeto', 'Mensalidade', 'Avulso', 'Outros'],
  despesa: ['Ferramentas e assinaturas', 'Impostos', 'Contador', 'Fornecedores/freelas', 'Marketing', 'Equipamento', 'Pró-labore', 'Outros'] };
const r2 = x => Math.round(x * 100) / 100;
const soma = l => r2(l.reduce((s, x) => s + +x.valor, 0));
const ehDespesa = x => x.tipo === 'despesa';
// AAAA-MM-DD do i-ésimo mês a partir de a/m/d (dia limitado a 28 para existir em todo mês)
const mesMais = (a, m, d, i) => new Date(Date.UTC(a, m - 1 + i, Math.min(d, 28))).toISOString().slice(0, 10);
const APAGAR = '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar lançamento</button>';

// formulário curto (aba do projeto) e completo (tela Financeiro)
const CAMPOS_PARCELA = [{ k: 'descricao', l: 'Descrição (ex.: entrada, 2ª parcela)' }, { k: 'valor', l: 'Valor (R$)', t: 'number', req: true, meia: true }, { k: 'vencimento', l: 'Vencimento', t: 'date', meia: true },
  { k: 'forma', l: 'Forma (Pix, boleto…)', meia: true }, { k: 'pago_em', l: 'Pago em (vazio = em aberto)', t: 'date', meia: true }];
const camposLanc = (tipo, cs, atual) => [
  { k: 'descricao', l: 'Descrição', req: true },
  { k: 'valor', l: 'Valor (R$)', t: 'number', req: true, meia: true }, { k: 'vencimento', l: 'Vencimento', t: 'date', req: true, meia: true },
  { k: 'forma', l: 'Forma (Pix, boleto, cartão…)', meia: true }, { k: 'pago_em', l: `${tipo === 'despesa' ? 'Pago' : 'Recebido'} em (vazio = em aberto)`, t: 'date', meia: true },
  { k: 'categoria', l: 'Categoria', t: 'select', o: [...new Set([...CATEGORIAS[tipo], atual].filter(Boolean))].map(c => [c, c]), meia: true },
  { k: 'cliente_id', l: 'Cliente (opcional)', t: 'select', o: [['', '—'], ...opcoesClientes(cs)], meia: true }];

/* ---------- linhas da tabela ---------- */
function situacao(x) {
  if (x.pago_em) return `<span class="pill p-aprovado">${ehDespesa(x) ? 'Pago' : 'Recebido'} ${dataBR(x.pago_em)}</span>`;
  return venceu(x.vencimento) ? '<span class="pill p-revisao">Atrasada</span>' : '<span class="pill">Em aberto</span>';
}
function linhaParcela(x, completa) {
  const vinc = [x.crm_projetos && `<a href="#/projeto/${esc(x.crm_projetos.id)}">${esc(x.crm_projetos.nome)}</a>`,
    x.crm_clientes && `<a href="#/cliente/${esc(x.crm_clientes.id)}">${esc(x.crm_clientes.empresa || x.crm_clientes.nome)}</a>`,
    x.crm_contratos && `<a href="#/contrato/${esc(x.crm_contratos.id)}">${esc(x.crm_contratos.titulo)}</a>`].filter(Boolean).join(' · ');
  const desc = completa ? `<b>${esc(x.descricao || x.categoria || '—')}</b>${vinc ? `<br><small class="mute">${vinc}</small>` : ''}` : esc(x.descricao);
  return `<tr data-parc="${esc(x.id)}" style="cursor:pointer"><td>${dataBR(x.vencimento)}</td><td>${desc}</td>${completa ? `<td><small>${esc(x.categoria)}</small></td>` : ''}
    <td class="dir ${ehDespesa(x) ? 'mute' : ''}">${ehDespesa(x) ? '−' : ''}${brl(x.valor)}</td><td>${situacao(x)}</td>
    <td class="dir">${x.pago_em ? '' : `<button class="bt peq sec" data-pagar="${esc(x.id)}">${ehDespesa(x) ? 'Paguei' : 'Recebi'}</button>`}</td></tr>`;
}
// cs (clientes) presente = formulário completo com categoria e cliente
function ligarParcelas(el, lista, depois, cs) {
  el.querySelectorAll('[data-parc] a').forEach(a => a.onclick = ev => ev.stopPropagation()); // link navega, não abre o formulário
  el.querySelectorAll('[data-pagar]').forEach(b => b.onclick = async ev => {
    ev.stopPropagation();
    await q(sb.from('crm_parcelas').update({ pago_em: hoje() }).eq('id', b.dataset.pagar));
    toast(b.textContent === 'Paguei' ? 'Pagamento registrado' : 'Recebimento registrado'); depois();
  });
  el.querySelectorAll('[data-parc]').forEach(tr => tr.onclick = async () => {
    const x = lista.find(z => z.id === tr.dataset.parc), tipo = x.tipo || 'receita';
    const v = await formulario(tipo === 'despesa' ? 'Despesa' : cs ? 'Receita' : 'Parcela', cs ? camposLanc(tipo, cs, x.categoria) : CAMPOS_PARCELA, x, APAGAR);
    if ($('#dlg').returnValue === 'apagar') { await q(sb.from('crm_parcelas').delete().eq('id', x.id)); return depois(); }
    if (v) { await q(sb.from('crm_parcelas').update({ ...v, valor: r2(v.valor) }).eq('id', x.id)); depois(); }
  });
}

/* ---------- aba Financeiro dentro do projeto ---------- */
export function abaFinanceiro(p, el, recarregar) {
  const ps = p.crm_parcelas.filter(x => !ehDespesa(x)).sort((a, b) => (a.vencimento || '').localeCompare(b.vencimento || ''));
  const total = soma(ps), pago = soma(ps.filter(x => x.pago_em));
  el.innerHTML = `<div class="grade" style="margin-bottom:16px">
      <div class="card kpi"><div class="rot">Contrato</div><div class="num">${brl(p.valor)}</div></div>
      <div class="card kpi"><div class="rot">Recebido</div><div class="num">${brl(pago)}</div></div>
      <div class="card kpi"><div class="rot">Em aberto</div><div class="num">${brl(total - pago)}</div>${p.valor && Math.abs(total - p.valor) > .01 ? `<small class="atrasado">Parcelas somam ${brl(total)}</small>` : ''}</div></div>
    <div class="card"><div class="acoes" style="justify-content:flex-end;margin-bottom:8px"><button class="bt peq sec" id="dividir">Dividir em parcelas</button><button class="bt peq" id="nParc">+ Parcela</button></div>
    <table><thead><tr><th>Vence</th><th>Descrição</th><th class="dir">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${ps.map(x => linhaParcela(x)).join('') || '<tr><td colspan="5" class="vazio">Nenhuma parcela lançada.</td></tr>'}</tbody></table></div>`;
  const base = { tipo: 'receita', categoria: 'Projeto', projeto_id: p.id, cliente_id: p.cliente_id };
  ligarParcelas(el, ps, recarregar);
  $('#nParc').onclick = async () => { const v = await formulario('Nova parcela', CAMPOS_PARCELA); if (v) { await q(sb.from('crm_parcelas').insert({ ...base, ...v, valor: r2(v.valor) })); recarregar(); } };
  $('#dividir').onclick = async () => {
    const v = await formulario('Dividir em parcelas', [{ k: 'valor', l: 'Valor total (R$)', t: 'number', req: true, meia: true }, { k: 'n', l: 'Parcelas', t: 'number', req: true, meia: true }, { k: 'inicio', l: '1º vencimento', t: 'date', req: true, meia: true }, { k: 'forma', l: 'Forma', meia: true }], { valor: p.valor || '', n: 2, inicio: hoje() });
    if (!v) return;
    const n = Math.max(1, Math.round(v.n)), [a, m, d] = v.inicio.split('-').map(Number);
    await q(sb.from('crm_parcelas').insert(dividir(v.valor, n).map((valor, i) => ({ ...base, descricao: `${i + 1}/${n}`, forma: v.forma, valor, vencimento: mesMais(a, m, d, i) }))));
    if (!p.valor) await q(sb.from('crm_projetos').update({ valor: r2(v.valor) }).eq('id', p.id)); // contrato vazio: assume o total
    toast(`${n} parcelas lançadas`); recarregar();
  };
}
// divide em n parcelas iguais em centavos; a última absorve a sobra
function dividir(total, n) {
  const cents = Math.round(total * 100), base = Math.floor(cents / n);
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100);
}

/* ---------- tela: #/financeiro ---------- */
const FILTROS = {
  receitas: ['Receitas abertas', x => !ehDespesa(x) && !x.pago_em],
  despesas: ['Despesas abertas', x => ehDespesa(x) && !x.pago_em],
  atrasadas: ['Atrasadas', x => !x.pago_em && venceu(x.vencimento)],
  pagas: ['Pagas/recebidas', x => x.pago_em],
  todas: ['Todas', () => true] };

export async function financeiro(filtro = 'receitas') {
  if (!FILTROS[filtro]) filtro = 'receitas';
  const [ps, cs] = await Promise.all([
    q(sb.from('crm_parcelas').select('*,crm_projetos(id,nome),crm_clientes(id,codigo,nome,empresa),crm_contratos(id,titulo)').order('vencimento')),
    listaClientes()]);
  const mes = hoje().slice(0, 7), em30 = diaLocal(30);
  const rec = ps.filter(x => !ehDespesa(x)), desp = ps.filter(ehDespesa);
  const recMes = soma(rec.filter(x => x.pago_em?.startsWith(mes))), pagoMes = soma(desp.filter(x => x.pago_em?.startsWith(mes)));
  const atras = rec.filter(x => !x.pago_em && venceu(x.vencimento)), prox = rec.filter(x => !x.pago_em && !venceu(x.vencimento) && x.vencimento <= em30);
  // receitas e despesas pagas por mês, últimos 6 meses
  const meses = Array.from({ length: 6 }, (_, i) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 5 + i); return d.toLocaleDateString('sv').slice(0, 7); });
  const porMes = l => meses.map(m => soma(l.filter(x => x.pago_em?.startsWith(m))));
  const rM = porMes(rec), dM = porMes(desp), max = Math.max(...rM, ...dM, 1);
  const barra = (v, cor, rot) => `<div title="${rot}: ${brl(v)}" style="flex:1;height:${Math.max(2, 52 * v / max)}px;background:${cor};border-radius:3px 3px 0 0"></div>`;
  const quadrado = cor => `<i style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${cor}"></i>`;
  const CR = 'var(--wine)', CD = '#c9a06388';
  const lista = ps.filter(FILTROS[filtro][1]);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Dinheiro</div><h1>Financeiro</h1><p>“Recebi” e “Paguei” são sempre manuais: nada muda sozinho.</p></div>
      <div class="acoes"><button class="bt sec" id="csv">Exportar CSV</button><button class="bt sec" id="nDesp">+ Despesa</button><button class="bt" id="nRec">+ Receita</button></div></div>
    <div class="grade" style="margin-bottom:18px">
      <div class="card kpi"><div class="rot">Recebido no mês</div><div class="num">${brl(recMes)}</div></div>
      <div class="card kpi"><div class="rot">Pago no mês</div><div class="num">${brl(pagoMes)}</div><small class="mute">despesas</small></div>
      <div class="card kpi"><div class="rot">Saldo do mês</div><div class="num ${recMes - pagoMes < 0 ? 'atrasado' : ''}">${brl(r2(recMes - pagoMes))}</div></div>
      <div class="card kpi"><div class="rot">A receber em 30 dias</div><div class="num">${brl(soma(prox))}</div><small class="mute">${prox.length} lançamento(s)</small></div>
      <div class="card kpi"><div class="rot">Atrasado</div><div class="num ${atras.length ? 'atrasado' : ''}">${brl(soma(atras))}</div><small class="mute">${atras.length} receita(s)</small></div>
      <div class="card kpi"><div class="rot">6 meses</div>
        <div style="display:flex;align-items:flex-end;gap:6px;height:64px;margin-top:8px">${meses.map((m, i) => `<div style="flex:1;display:grid;gap:3px;justify-items:center">
          <div style="width:100%;display:flex;align-items:flex-end;gap:2px;height:52px">${barra(rM[i], CR, m + ' recebido')}${barra(dM[i], CD, m + ' pago')}</div>
          <small class="mute" style="font-size:.62rem">${new Date(m + '-15').toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '')}</small></div>`).join('')}</div>
        <small class="mute" style="font-size:.68rem">${quadrado(CR)} receitas &nbsp; ${quadrado(CD)} despesas</small></div></div>
    <div class="tabs" style="overflow-x:auto">${Object.entries(FILTROS).map(([f, [l]]) => `<button data-f="${f}" class="${f === filtro ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="card"><table><thead><tr><th>Vence</th><th>Descrição</th><th>Categoria</th><th class="dir">Valor</th><th>Situação</th><th></th></tr></thead><tbody>${lista.map(x => linhaParcela(x, true)).join('') || '<tr><td colspan="6" class="vazio">Nada aqui.</td></tr>'}</tbody></table></div>`;
  const recarregar = () => financeiro(filtro);
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => financeiro(b.dataset.f));
  ligarParcelas(main, ps, recarregar, cs);
  const novo = async tipo => {
    const v = await formulario(tipo === 'despesa' ? 'Nova despesa' : 'Nova receita', camposLanc(tipo, cs), { vencimento: hoje(), categoria: tipo === 'receita' ? 'Avulso' : null });
    if (v) { await q(sb.from('crm_parcelas').insert({ ...v, tipo, valor: r2(v.valor) })); toast('Lançamento criado'); recarregar(); }
  };
  $('#nRec').onclick = () => novo('receita');
  $('#nDesp').onclick = () => novo('despesa');
  $('#csv').onclick = () => baixarCsv(lista, `financeiro-${filtro}-${hoje()}.csv`);
}

// CSV para o Excel brasileiro: separador ;, vírgula decimal, BOM UTF-8. Despesa sai com valor negativo.
function baixarCsv(lista, nome) {
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const data = d => d ? d.split('-').reverse().join('/') : '';
  const linhas = [['Tipo', 'Vencimento', 'Descrição', 'Categoria', 'Cliente', 'Projeto', 'Contrato', 'Valor', 'Forma', 'Pago em', 'Situação'],
    ...lista.map(x => [ehDespesa(x) ? 'Despesa' : 'Receita', data(x.vencimento), x.descricao, x.categoria, x.crm_clientes ? x.crm_clientes.empresa || x.crm_clientes.nome : '',
      x.crm_projetos?.nome, x.crm_contratos?.titulo, (ehDespesa(x) ? -x.valor : +x.valor).toFixed(2).replace('.', ','), x.forma, data(x.pago_em),
      x.pago_em ? (ehDespesa(x) ? 'Pago' : 'Recebido') : venceu(x.vencimento) ? 'Atrasada' : 'Em aberto'])];
  const url = URL.createObjectURL(new Blob(['﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: nome }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/* ---------- contrato → lançamentos ---------- */
// meses de vigência: jan/10 → jan/09 do ano seguinte = 12; mínimo 1
function mesesEntre(ini, fim) {
  const [ai, mi, di] = ini.split('-').map(Number), [af, mf, df] = fim.split('-').map(Number);
  return Math.max(1, (af - ai) * 12 + (mf - mi) + (df > di ? 1 : 0));
}

// Lança mensalidades (recorrente/misto) e o valor avulso (avulso/misto) de um contrato. Pula meses já lançados.
// Devolve quantos lançamentos criou, ou null se cancelou.
export async function lancarMensalidades(c) {
  const mensal = c.tipo !== 'avulso' && c.valor_mensal != null, avulso = c.tipo !== 'recorrente' && c.valor_avulso != null;
  if (!mensal && !avulso) { toast('Este contrato não tem valor para lançar', true); return null; }
  const ja = await q(sb.from('crm_parcelas').select('categoria,vencimento,valor').eq('contrato_id', c.id).eq('tipo', 'receita'));
  const mesesLancados = new Set(ja.filter(x => x.categoria === 'Mensalidade' && x.vencimento).map(x => x.vencimento.slice(0, 7)));
  const avulsoLancado = soma(ja.filter(x => x.categoria === 'Avulso'));
  const campos = [
    ...(mensal ? [{ k: 'valor', l: 'Valor mensal (R$)', t: 'number', req: true, meia: true }, { k: 'n', l: 'Nº de meses (0 = não lançar)', t: 'number', req: true, meia: true },
      { k: 'inicio', l: '1º vencimento', t: 'date', req: true, meia: true }] : []),
    { k: 'forma', l: 'Forma (Pix, boleto…)', meia: true },
    ...(avulso ? [{ k: 'av_valor', l: 'Valor avulso (R$)', t: 'number', req: true, meia: true }, { k: 'av_n', l: 'Parcelas do avulso (0 = não lançar)', t: 'number', req: true, meia: true },
      { k: 'av_inicio', l: '1º vencimento do avulso', t: 'date', req: true, meia: true }] : [])];
  const v = await formulario('Lançar no financeiro', campos, {
    valor: c.valor_mensal, n: c.inicio && c.fim ? mesesEntre(c.inicio, c.fim) : 12, inicio: c.inicio || hoje(),
    av_valor: c.valor_avulso, av_n: avulsoLancado ? 0 : 1, av_inicio: c.inicio || hoje() },
    `<p class="mute">Meses que já têm mensalidade deste contrato são pulados.${avulsoLancado ? ` Avulso já lançado: ${brl(avulsoLancado)}.` : ''}</p>`, 'Lançar');
  if (!v) return null;
  const base = { tipo: 'receita', contrato_id: c.id, cliente_id: c.cliente_id, projeto_id: c.projeto_id ?? null, forma: v.forma };
  const linhas = []; let pulados = 0;
  if (mensal && v.n > 0) {
    const [a, m, d] = v.inicio.split('-').map(Number);
    for (let i = 0; i < Math.round(v.n); i++) {
      const venc = mesMais(a, m, d, i);
      if (mesesLancados.has(venc.slice(0, 7))) { pulados++; continue; }
      linhas.push({ ...base, categoria: 'Mensalidade', descricao: `Mensalidade ${venc.slice(5, 7)}/${venc.slice(0, 4)}`, valor: r2(v.valor), vencimento: venc });
    }
  }
  if (avulso && v.av_n > 0) {
    const n = Math.max(1, Math.round(v.av_n)), [a, m, d] = v.av_inicio.split('-').map(Number);
    dividir(v.av_valor, n).forEach((valor, i) => linhas.push({ ...base, categoria: 'Avulso', descricao: n > 1 ? `Avulso ${i + 1}/${n}` : 'Avulso', valor, vencimento: mesMais(a, m, d, i) }));
  }
  if (linhas.length) await q(sb.from('crm_parcelas').insert(linhas));
  toast(`${linhas.length} lançamento(s) criado(s)${pulados ? ` · ${pulados} mês(es) já lançado(s), pulado(s)` : ''}`);
  return linhas.length;
}
