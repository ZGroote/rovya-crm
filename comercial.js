// comercial: catálogo de serviços e propostas versionadas (tabelas crm_servicos e crm_propostas)
import { sb, $, main, esc, brl, hoje, diaLocal, dataBR, venceu, toast, q, rotulo, preencher, mdHtml, formulario, confirma, listaClientes, opcoesClientes } from './util.js';
import { novoContrato } from './contratos.js';

const STATUS_PROP = [['rascunho', 'Rascunho'], ['enviada', 'Enviada'], ['aprovada', 'Aprovada'], ['recusada', 'Recusada']];
const COR_PROP = { rascunho: 'p-a_fazer', enviada: 'p-enviado', aprovada: 'p-aprovado', recusada: 'p-revisao' };
const pillProp = st => `<span class="pill ${COR_PROP[st] || ''}">${rotulo(STATUS_PROP, st)}</span>`;
const BT_APAGAR = t => `<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">${t}</button>`;

// dinheiro: sempre em centavos arredondados
const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const subItem = it => r2((Number(it.qtd) || 0) * (Number(it.preco) || 0));
const bruto = its => r2((its || []).reduce((s, it) => s + subItem(it), 0));
const totalDe = (its, desconto) => Math.max(0, r2(bruto(its) - r2(desconto)));

// só a última versão de cada grupo, na ordem em que vieram
const ultimas = ps => { const u = {}; for (const x of ps) if (!u[x.grupo] || x.versao > u[x.grupo].versao) u[x.grupo] = x; return Object.values(u); };
const validadeHtml = x => !x.validade ? '' : ['rascunho', 'enviada'].includes(x.status) && venceu(x.validade)
  ? `<span class="atrasado">vencida ${dataBR(x.validade)}</span>` : `<span class="mute">até ${dataBR(x.validade)}</span>`;

/* ---------- SERVIÇOS (catálogo) ---------- */
const CAMPOS_SERVICO = [
  { k: 'codigo', l: 'Código', meia: true }, { k: 'categoria', l: 'Categoria', meia: true },
  { k: 'nome', l: 'Nome', req: true }, { k: 'descricao', l: 'Descrição curta (vai para a proposta)', t: 'textarea', linhas: 2 },
  { k: 'escopo', l: 'Escopo', t: 'textarea', linhas: 5 }, { k: 'entregaveis', l: 'Entregáveis (um por linha)', t: 'textarea', linhas: 5 },
  { k: 'preco', l: 'Preço base (R$)', t: 'number', meia: true }, { k: 'ativo', l: 'Ativo', t: 'select', o: [['true', 'Sim'], ['false', 'Não']], padrao: 'true', meia: true }];

async function editarServico(s) {
  const v = await formulario(s ? s.nome : 'Novo serviço', CAMPOS_SERVICO, s || {}, s ? BT_APAGAR('Apagar serviço') : '');
  if ($('#dlg').returnValue === 'apagar') { if (await confirma(`Apagar “${s.nome}” do catálogo? Propostas já feitas não mudam.`)) await q(sb.from('crm_servicos').delete().eq('id', s.id)); return; }
  if (!v) return;
  v.ativo = v.ativo !== 'false'; if (v.preco != null) v.preco = r2(v.preco);
  await q(s ? sb.from('crm_servicos').update(v).eq('id', s.id) : sb.from('crm_servicos').insert(v)); toast('Serviço salvo');
}

export async function servicos() {
  const ss = await q(sb.from('crm_servicos').select('*').order('categoria', { nullsFirst: false }).order('nome'));
  const tabela = l => `<table><thead><tr><th>Código</th><th>Serviço</th><th class="esconde-cel">Categoria</th><th class="dir">Preço base</th><th>Situação</th></tr></thead><tbody>${l.map(s => `<tr data-id="${s.id}" style="cursor:pointer">
    <td><small class="mute">${esc(s.codigo)}</small></td><td><b>${esc(s.nome)}</b>${s.descricao ? `<br><small class="mute">${esc(s.descricao)}</small>` : ''}</td>
    <td class="esconde-cel">${esc(s.categoria)}</td><td class="dir">${s.preco != null ? brl(s.preco) : '—'}</td><td>${s.ativo ? '<span class="pill p-aprovado">Ativo</span>' : '<span class="pill">Inativo</span>'}</td></tr>`).join('')}</tbody></table>`;
  const ativos = ss.filter(s => s.ativo), inativos = ss.filter(s => !s.ativo);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Serviços</h1><p>O catálogo que alimenta as propostas. Mudar aqui não altera propostas já feitas.</p></div><button class="bt" id="nServ">+ Serviço</button></div>
    <div class="card">${ativos.length ? tabela(ativos) : '<p class="vazio">Nenhum serviço ativo. Cadastre os serviços que a ROVYA vende.</p>'}</div>
    ${inativos.length ? `<h2 style="margin:28px 0 12px">Inativos</h2><div class="card" style="opacity:.6">${tabela(inativos)}</div>` : ''}`;
  const porId = Object.fromEntries(ss.map(s => [s.id, s]));
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = async () => { await editarServico(porId[tr.dataset.id]); servicos(); });
  $('#nServ').onclick = async () => { await editarServico(); servicos(); };
}

/* ---------- PROPOSTAS ---------- */
export async function novaProposta(val = {}) {
  const [cs, mods] = await Promise.all([listaClientes(), q(sb.from('crm_modelos').select('id,titulo,corpo').eq('tipo', 'proposta').order('titulo'))]);
  if (!cs.length) { toast('Cadastre um cliente primeiro'); return null; }
  const v = await formulario('Nova proposta', [
    { k: 'cliente_id', l: 'Cliente', t: 'select', o: [['', 'Selecione…'], ...opcoesClientes(cs)], req: true },
    { k: 'titulo', l: 'Título', req: true },
    { k: 'modelo', l: 'Começar a partir de', t: 'select', o: [...mods.map(m => [m.id, m.titulo]), ['', 'Em branco']] },
    { k: 'validade', l: 'Válida até', t: 'date' }],
    { modelo: mods[0]?.id ?? '', validade: diaLocal(15), ...val });
  if (!v) return null;
  let corpo = null;
  if (v.modelo) { const [c] = await q(sb.from('crm_clientes').select('*').eq('id', v.cliente_id)); corpo = preencher(mods.find(m => m.id === v.modelo).corpo, c); }
  const [p] = await q(sb.from('crm_propostas').insert({ cliente_id: v.cliente_id, oportunidade_id: val.oportunidade_id || null, titulo: v.titulo, corpo, validade: v.validade }).select('id'));
  toast('Proposta criada'); location.hash = '#/proposta/' + p.id; return p.id;
}

export async function propostas() {
  const ps = ultimas(await q(sb.from('crm_propostas').select('id,grupo,versao,titulo,valor,validade,status,crm_clientes(nome,empresa,codigo)').order('criado_em', { ascending: false })));
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Propostas</h1><p>Cada proposta mostra só a versão mais recente; as anteriores ficam no histórico dela.</p></div><button class="bt" id="nProp">+ Proposta</button></div>
    ${STATUS_PROP.map(([k, l]) => { const g = ps.filter(x => x.status === k); return g.length ? `<h2 style="margin:8px 0 12px">${l}</h2><section class="card" style="margin-bottom:22px"><ul class="lista">${g.map(x => `<li>
      <a class="cresce" href="#/proposta/${x.id}"><b>${esc(x.titulo)}</b> <span class="pill">v${x.versao}</span><small>${esc(x.crm_clientes?.empresa || x.crm_clientes?.nome)}${x.crm_clientes?.codigo ? ' · ' + esc(x.crm_clientes.codigo) : ''}</small></a>
      <b>${brl(x.valor)}</b>${validadeHtml(x)}</li>`).join('')}</ul></section>` : ''; }).join('') || '<p class="vazio">Nenhuma proposta ainda.</p>'}`;
  $('#nProp').onclick = () => novaProposta();
}

export async function propostasDoCliente(clienteId) {
  const ps = ultimas(await q(sb.from('crm_propostas').select('id,grupo,versao,titulo,valor,validade,status').eq('cliente_id', clienteId).order('criado_em', { ascending: false })));
  return `<section class="card"><h3>Propostas</h3><ul class="lista">${ps.map(x => `<li><a class="cresce" href="#/proposta/${x.id}"><b>${esc(x.titulo)}</b><small>v${x.versao} · ${brl(x.valor)}</small></a>${pillProp(x.status)}</li>`).join('') || '<li class="vazio">Nenhuma proposta.</li>'}</ul>
    <button class="bt peq sec" data-nova-proposta="${esc(clienteId)}">+ Proposta</button></section>`;
}

const CAMPOS_ITEM = [{ k: 'nome', l: 'Serviço', req: true }, { k: 'descricao', l: 'Descrição', t: 'textarea', linhas: 3 },
  { k: 'qtd', l: 'Quantidade', t: 'number', req: true, meia: true }, { k: 'preco', l: 'Valor unitário (R$)', t: 'number', req: true, meia: true }];
const CAMPO_TELA = 'padding:9px 12px;border:1px solid var(--line);border-radius:8px;background:#fff;width:100%';

export async function proposta(id) {
  const [p] = await q(sb.from('crm_propostas').select('*,crm_clientes(*)').eq('id', id));
  if (!p) { main.innerHTML = '<p class="vazio">Proposta não encontrada.</p>'; return; }
  const [vers, servs] = await Promise.all([
    q(sb.from('crm_propostas').select('id,versao').eq('grupo', p.grupo).order('versao')),
    q(sb.from('crm_servicos').select('id,codigo,nome,descricao,preco').eq('ativo', true).order('nome'))]);
  const c = p.crm_clientes, ult = vers.at(-1), ro = p.versao < ult.versao; // versões antigas = histórico, só leitura
  const itens = p.itens || [];
  const dis = ro ? 'disabled' : '';
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/cliente/${c.id}">${esc(c.empresa || c.nome)}</a> · <a href="#/propostas">Propostas</a></div><h1 id="pTit">${esc(p.titulo)}</h1>
      <p>Proposta · ${vers.map(v => v.id === id ? `<b>v${v.versao}</b>` : `<a href="#/proposta/${v.id}">v${v.versao}</a>`).join(' · ')}${p.enviada_em ? ' · enviada ' + dataBR(p.enviada_em) : ''}</p></div>
    <div class="acoes"><select id="st" class="busca" style="min-width:0">${STATUS_PROP.map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="bt sec" id="pdf">Gerar PDF</button><button class="bt sec" id="nv">Nova versão</button>${ro ? '' : '<button class="bt" id="salvar">Salvar</button>'}</div></div>
    ${ro ? `<p class="card mute" style="margin:0 0 16px">Esta v${p.versao} é histórico e não se edita. Abra a <a href="#/proposta/${ult.id}">v${ult.versao}</a> ou use “Nova versão” para partir desta.</p>` : ''}
    <div class="acoes" style="margin-bottom:18px">${p.status !== 'enviada' ? '<button class="bt peq sec" data-st="enviada">Marcar enviada</button>' : ''}${p.status !== 'aprovada' ? '<button class="bt peq sec" data-st="aprovada">Aprovada</button>' : ''}${p.status !== 'recusada' ? '<button class="bt peq sec" data-st="recusada">Recusada</button>' : ''}
      <button class="bt peq fantasma" id="apagar" style="color:var(--bad)">Apagar esta versão</button></div>
    <section class="card" style="margin-bottom:18px"><div class="topo" style="margin-bottom:6px;align-items:center"><h3>Itens</h3>${ro ? '' : '<div class="acoes"><button class="bt peq sec" id="doCat">+ Do catálogo</button><button class="bt peq sec" id="livre">+ Item livre</button></div>'}</div>
      <table><thead><tr><th>Serviço</th><th class="dir">Qtd</th><th class="dir esconde-cel">Valor</th><th class="dir">Subtotal</th></tr></thead><tbody id="itens"></tbody><tfoot id="tot"></tfoot></table></section>
    <div class="grade2">
      <section class="card" style="display:grid;gap:12px"><h3>Texto da proposta</h3>
        <label class="mute" style="display:grid;gap:4px;font-size:.78rem">Título<input id="fTit" style="${CAMPO_TELA}" value="${esc(p.titulo)}" ${dis}></label>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <label class="mute" style="display:grid;gap:4px;font-size:.78rem">Válida até<input id="fVal" type="date" style="${CAMPO_TELA}" value="${esc(p.validade)}" ${dis}></label>
          <label class="mute" style="display:grid;gap:4px;font-size:.78rem">Desconto (R$)<input id="fDesc" type="number" step="0.01" min="0" style="${CAMPO_TELA}" value="${esc(p.desconto || '')}" ${dis}></label></div>
        <label class="mute" style="display:grid;gap:4px;font-size:.78rem">Corpo (## título, **negrito**)<textarea id="fCorpo" style="${CAMPO_TELA};min-height:420px;resize:vertical" ${dis}>${esc(p.corpo)}</textarea></label></section>
      <section class="card"><h3>Pré-visualização</h3><div class="ori"><div class="txt" id="prev" style="max-height:none"></div></div></section></div>`;

  const desc = () => r2($('#fDesc').value);
  const desenha = () => {
    $('#itens').innerHTML = itens.map((it, i) => `<tr data-i="${i}" ${ro ? '' : 'style="cursor:pointer"'}><td><b>${esc(it.nome)}</b>${it.descricao ? `<br><small class="mute" style="white-space:pre-wrap">${esc(it.descricao)}</small>` : ''}</td>
      <td class="dir">${esc(it.qtd)}</td><td class="dir esconde-cel">${brl(it.preco)}</td><td class="dir">${brl(subItem(it))}</td></tr>`).join('') || '<tr><td colspan="4" class="vazio">Nenhum item. Adicione do catálogo ou um item livre.</td></tr>';
    $('#tot').innerHTML = (desc() ? `<tr><td colspan="3" class="dir mute">Desconto</td><td class="dir">− ${brl(desc())}</td></tr>` : '')
      + `<tr><td colspan="3" class="dir"><b>Total</b></td><td class="dir"><b>${brl(totalDe(itens, desc()))}</b></td></tr>`;
  };
  const previa = () => $('#prev').innerHTML = mdHtml($('#fCorpo').value) || '<span class="vazio">Sem texto.</span>';
  desenha(); previa();
  $('#fCorpo').oninput = previa; $('#fDesc').oninput = desenha;

  // grava tudo o que está na tela (nunca mexe no status)
  const salvar = async () => {
    if (ro) return;
    const v = { titulo: $('#fTit').value.trim() || p.titulo, validade: $('#fVal').value || null, desconto: desc(), corpo: $('#fCorpo').value, itens };
    v.valor = totalDe(itens, v.desconto);
    await q(sb.from('crm_propostas').update(v).eq('id', id)); Object.assign(p, v); $('#pTit').textContent = p.titulo;
  };
  const item = async (it = { qtd: 1 }, i = -1) => {
    const v = await formulario(i < 0 ? 'Item livre' : 'Item', CAMPOS_ITEM, it, i < 0 ? '' : BT_APAGAR('Remover item'));
    if ($('#dlg').returnValue === 'apagar') itens.splice(i, 1);
    else if (!v) return;
    else { const novo = { servico_id: it.servico_id || null, ...v, qtd: Number(v.qtd) || 0, preco: r2(v.preco) }; i < 0 ? itens.push(novo) : (itens[i] = novo); }
    await salvar(); desenha();
  };

  if (!ro) {
    $('#salvar').onclick = async () => { await salvar(); toast('Proposta salva'); };
    $('#livre').onclick = () => item();
    $('#itens').onclick = e => { const tr = e.target.closest('tr[data-i]'); if (tr) item(itens[tr.dataset.i], +tr.dataset.i); };
    $('#doCat').onclick = async () => {
      if (!servs.length) { toast('Nenhum serviço ativo no catálogo'); return; }
      const v = await formulario('Adicionar do catálogo', [{ k: 's', l: 'Serviço', t: 'select', o: servs.map(s => [s.id, (s.codigo ? s.codigo + ' · ' : '') + s.nome + (s.preco != null ? ' · ' + brl(s.preco) : '')]) },
        { k: 'qtd', l: 'Quantidade', t: 'number', req: true }], { qtd: 1 });
      if (!v) return;
      const s = servs.find(x => x.id === v.s); // copia: o item não acompanha mudanças futuras do catálogo
      itens.push({ servico_id: s.id, nome: s.nome, descricao: s.descricao || '', qtd: Number(v.qtd) || 0, preco: r2(s.preco) });
      await salvar(); desenha();
    };
  }

  const mudar = async st => {
    await salvar();
    await q(sb.from('crm_propostas').update({ status: st, ...(st === 'enviada' && { enviada_em: hoje() }) }).eq('id', id));
    toast('Proposta ' + rotulo(STATUS_PROP, st).toLowerCase());
    if (st === 'aprovada' && await confirma('Criar o contrato agora?')
      && await novoContrato({ cliente_id: c.id, proposta_id: id, titulo: p.titulo, valor_avulso: p.valor })) return; // contratos.js navega sozinho
    proposta(id);
  };
  $('#st').onchange = e => mudar(e.target.value);
  main.querySelectorAll('[data-st]').forEach(b => b.onclick = () => mudar(b.dataset.st));

  $('#nv').onclick = async () => {
    await salvar();
    const { id: _, criado_em, crm_clientes, enviada_em, ...base } = p;
    const [n] = await q(sb.from('crm_propostas').insert({ ...base, versao: ult.versao + 1, status: 'rascunho' }).select('id'));
    toast(`v${ult.versao + 1} criada`); location.hash = '#/proposta/' + n.id;
  };
  $('#pdf').onclick = async () => { await salvar(); imprimir(p, c); };
  $('#apagar').onclick = async () => {
    if (!await confirma(`Apagar a v${p.versao} desta proposta? As outras versões ficam.`)) return;
    await q(sb.from('crm_propostas').delete().eq('id', id));
    const resto = vers.filter(v => v.id !== id);
    location.hash = resto.length ? '#/proposta/' + resto.at(-1).id : '#/propostas';
  };
}

/* ---------- PDF (impressão do navegador → “Salvar como PDF”) ---------- */
const dataLonga = d => new Date(d + 'T12:00').toLocaleDateString('pt-BR', { day: 'numeric', month: 'long', year: 'numeric' });
// padrão do manual: ROVYA_[CLIENTE]_[TIPO]_[AAAA-MM-DD]_V01
const nomeArquivo = (p, c) => `ROVYA_${(c.codigo || c.empresa || c.nome || 'CLIENTE').normalize('NFD').replace(/[^\w-]+/g, '').toUpperCase()}_PROPOSTA_${hoje()}_V${String(p.versao).padStart(2, '0')}`;

async function imprimir(p, c) {
  document.getElementById('impressao')?.remove();
  const its = p.itens || [], desconto = r2(p.desconto);
  const d = document.createElement('div'); d.id = 'impressao';
  d.innerHTML = `<header><img src="img/rosa.svg" alt=""><span><b>ROVYA</b><small>CREATIVE</small></span></header>
    <div class="cab"><div><div class="rot">Proposta comercial</div><h1>${esc(p.titulo)}</h1></div><div class="meta">Proposta · v${p.versao}<br>${dataLonga(hoje())}</div></div>
    <section class="cli"><small>Para</small><b>${esc(c.empresa || c.nome)}</b>
      ${c.empresa && c.nome ? `<small>A/C ${esc(c.nome)}</small>` : ''}${c.razao_social || c.documento ? `<small>${esc([c.razao_social, c.documento].filter(Boolean).join(' · '))}</small>` : ''}${c.codigo ? `<small>Cliente ${esc(c.codigo)}</small>` : ''}</section>
    ${p.corpo ? `<div class="corpo">${mdHtml(p.corpo)}</div>` : ''}
    ${its.length ? `<table><thead><tr><th>Serviço</th><th>Descrição</th><th class="dir">Qtd</th><th class="dir">Valor</th></tr></thead><tbody>
      ${its.map(it => `<tr><td><b>${esc(it.nome)}</b></td><td><small>${esc(it.descricao)}</small></td><td class="dir">${esc(it.qtd)}</td><td class="dir">${brl(subItem(it))}</td></tr>`).join('')}</tbody>
      <tfoot>${desconto ? `<tr><td colspan="3" class="dir">Subtotal</td><td class="dir">${brl(bruto(its))}</td></tr><tr><td colspan="3" class="dir">Desconto</td><td class="dir">− ${brl(desconto)}</td></tr>` : ''}
      <tr class="total"><td colspan="3" class="dir">Total</td><td class="dir">${brl(totalDe(its, desconto))}</td></tr></tfoot></table>` : ''}
    ${p.validade ? `<p class="val">Proposta válida até ${dataLonga(p.validade)}.</p>` : ''}
    <footer>ROVYA · Branding e Comunicação</footer>`;
  document.body.append(d);
  await d.querySelector('img').decode().catch(() => { });
  const titulo = document.title; document.title = nomeArquivo(p, c);
  addEventListener('afterprint', () => { d.remove(); document.title = titulo; }, { once: true });
  print();
}
