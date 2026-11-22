// PRODUÇÃO: todas as peças (entregas) dos projetos ativos, por status. Só a Sabrina muda o status e aprova (arrastando ou no select).
import { sb, $, main, esc, dataBR, diaLocal, venceu, toast, q, rotulo, confirma } from './util.js';
import { usoEscopo, textoUso, mesAtual } from './contratos.js';
import { rotuloMes } from './conteudo.js';

export const STATUS_ENT = [['a_fazer', 'A fazer'], ['produzindo', 'Em produção'], ['enviado', 'Enviado'], ['revisao', 'Em revisão'], ['aprovado', 'Aprovado']];
export const FORMATOS = ['Post feed', 'Carrossel', 'Reels / vídeo', 'Stories', 'PDF / documento', 'Apresentação', 'Logo / identidade', 'Texto', 'Impresso', 'Site / página'];

// selo curto da peça: formato e revisões (R2 = voltou duas vezes para revisão)
export const seloPeca = x => [x.formato ? `<span class="pill">${esc(x.formato)}</span>` : '', x.revisoes ? `<span class="pill p-revisao" title="${x.revisoes} rodada(s) de revisão">R${x.revisoes}</span>` : ''].join(' ');

// apaga peças e os arquivos delas no servidor (os registros dos anexos saem junto pelo banco).
// Arquivos só depois das peças: se apagar as peças falhar, nenhum arquivo some. Usada também ao apagar etapa e projeto.
export async function apagarEntregas(ids) {
  if (!ids.length) return;
  const anexos = await q(sb.from('crm_anexos').select('caminho').in('entrega_id', ids));
  await q(sb.from('crm_entregas').delete().in('id', ids));
  if (anexos.length) await sb.storage.from('crm-anexos').remove(anexos.map(a => a.caminho));
}

// sel = Set das peças marcadas quando ela está no modo "Selecionar" (null = modo normal, arrastar e abrir)
export async function producao(abrirEntrega, projetoId = '', sel = null) {
  const [es, ks] = await Promise.all([
    q(sb.from('crm_entregas').select('*,crm_anexos(id),crm_etapas!inner(titulo,consulta,crm_projetos!inner(id,nome,status,mes,contrato_id,crm_clientes(id,nome,empresa)))')
      .eq('crm_etapas.crm_projetos.status', 'ativo').order('prazo', { nullsFirst: false })),
    q(sb.from('crm_contratos').select('id,titulo,status,posts_mes,ajustes_inclusos,crm_clientes(nome,empresa)').eq('status', 'vigente').not('posts_mes', 'is', null))]);
  // escopo do mês: o que cada contrato mensal já usou (peças que o cliente aprova; "só consulta" não conta)
  const mes = mesAtual(), escopo = ks.filter(k => k.status === 'vigente' && k.posts_mes).map(k => {
    const ps = es.filter(x => x.crm_etapas.crm_projetos.contrato_id === k.id && x.crm_etapas.crm_projetos.mes === mes);
    return { k, u: usoEscopo(k, { crm_etapas: ps.map(x => ({ consulta: x.crm_etapas.consulta, crm_entregas: [x] })) }) };
  });
  const projs = [...new Map(es.map(x => [x.crm_etapas.crm_projetos.id, x.crm_etapas.crm_projetos])).values()];
  const desde = diaLocal(-30); // aprovadas há mais de 30 dias saem do quadro (continuam no projeto)
  const vis = es.filter(x => (!projetoId || x.crm_etapas.crm_projetos.id === projetoId) && (x.status !== 'aprovado' || (x.aprovado_em || '') >= desde));
  const nome = p => p.crm_clientes?.empresa || p.crm_clientes?.nome || 'Rovya';
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Operação</div><h1>Produção</h1><p>Todas as peças dos projetos ativos. Arraste entre as colunas ou abra a peça para mudar o status, o formato e anexar arquivos.</p></div>
    <div class="acoes"><select class="busca" id="filtroProj" style="min-width:0"><option value="">Todos os projetos</option>${projs.map(p => `<option value="${p.id}" ${p.id === projetoId ? 'selected' : ''}>${esc(nome(p))} · ${esc(p.nome)}</option>`).join('')}</select>
      ${vis.length && !sel ? '<button class="bt sec" id="selecionar">Selecionar</button>' : ''}</div></div>
    ${escopo.length ? `<div class="grade" style="margin-bottom:16px">${escopo.map(({ k, u }) => `<a class="card linkcard" href="#/contrato/${esc(k.id)}"><b>${esc(k.crm_clientes?.empresa || k.crm_clientes?.nome)}</b>
      <small class="mute" style="display:block">${esc(rotuloMes(mes))} · ${textoUso(u)}</small>${u.alem || u.posts > u.previstos ? '<span class="pill p-revisao">acima do contrato</span>' : u.posts < u.previstos ? `<span class="pill">faltam ${u.previstos - u.posts}</span>` : ''}</a>`).join('')}</div>` : ''}
    ${es.length ? '' : '<p class="vazio">Nenhuma peça em projetos ativos. As peças são as entregas de cada etapa do projeto.</p>'}
    <div class="funil">${STATUS_ENT.map(([k, l]) => {
      const lst = vis.filter(x => x.status === k);
      return `<section class="col" data-status="${k}"><header><b>${l}</b><span>${sel && lst.length ? `<button class="bt peq fantasma" data-todos="${k}">Marcar todos</button> ` : ''}${lst.length}</span></header>
      ${lst.map(x => { const p = x.crm_etapas.crm_projetos; return `<article class="op${sel?.has(x.id) ? ' marcada' : ''}" draggable="${!sel}" data-id="${x.id}">${sel ? `<input type="checkbox" class="marca" tabindex="-1" aria-hidden="true" ${sel.has(x.id) ? 'checked' : ''}>` : ''}<b>${esc(x.titulo)}</b>
        <small>${esc(nome(p))} · ${esc(x.crm_etapas.titulo)}</small>
        <div>${seloPeca(x)} ${x.crm_anexos.length ? '<span title="Tem arquivo">📎</span>' : ''}</div>
        ${x.prazo && k !== 'aprovado' ? `<small class="${venceu(x.prazo) ? 'atrasado' : ''}">prazo ${dataBR(x.prazo)}</small>` : ''}
        ${k === 'aprovado' && x.aprovado_em ? `<small>aprovado ${dataBR(x.aprovado_em.slice(0, 10))}</small>` : ''}</article>`; }).join('')}</section>`;
    }).join('')}</div>
    ${sel ? `<div class="barra-sel" role="region" aria-label="Peças selecionadas"><b id="nSel"></b>
      <select class="busca" id="moverPara" style="min-width:0"><option value="">Mover para…</option>${STATUS_ENT.map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
      <button class="bt peq perigo" id="apagarSel">Apagar</button><button class="bt peq fantasma" id="sairSel">Cancelar</button></div>` : ''}`;
  // só redesenha se ela ainda estiver na Produção (senão o redesenho atrasado cobriria a tela para onde ela foi)
  const recarregar = () => { if (location.hash.startsWith('#/producao')) producao(abrirEntrega, projetoId); };
  $('#filtroProj').onchange = e => producao(abrirEntrega, e.target.value, sel && new Set());
  const porId = Object.fromEntries(es.map(x => [x.id, x]));
  if (sel) return ligarSelecao(sel, vis, () => producao(abrirEntrega, projetoId));
  if ($('#selecionar')) $('#selecionar').onclick = () => producao(abrirEntrega, projetoId, new Set());
  main.querySelectorAll('.op').forEach(el => {
    el.onclick = async () => { const x = porId[el.dataset.id]; await abrirEntrega(x, x.crm_etapas.crm_projetos); recarregar(); };
    el.ondragstart = e => e.dataTransfer.setData('text/plain', el.dataset.id);
  });
  main.querySelectorAll('.col').forEach(col => {
    col.ondragover = e => { e.preventDefault(); col.classList.add('sobre'); };
    col.ondragleave = () => col.classList.remove('sobre');
    col.ondrop = async e => {
      e.preventDefault(); col.classList.remove('sobre');
      const x = porId[e.dataTransfer.getData('text/plain')]; if (!x || x.status === col.dataset.status) return;
      await q(sb.from('crm_entregas').update({ status: col.dataset.status, atualizado_em: new Date().toISOString() }).eq('id', x.id));
      toast(rotulo(STATUS_ENT, col.dataset.status)); recarregar();
    };
  });
}

// modo Selecionar: clicar no cartão marca/desmarca; "Marcar todos" por coluna; barra com Mover para… e Apagar
function ligarSelecao(sel, vis, sair) {
  const idsDa = st => vis.filter(x => x.status === st).map(x => x.id);
  const conta = () => {
    $('#nSel').textContent = sel.size === 1 ? '1 peça selecionada' : `${sel.size} peças selecionadas`;
    $('#apagarSel').disabled = $('#moverPara').disabled = !sel.size;
    main.querySelectorAll('[data-todos]').forEach(b => { b.textContent = idsDa(b.dataset.todos).every(i => sel.has(i)) ? 'Desmarcar' : 'Marcar todos'; });
  };
  const marcar = (id, sim) => {
    sim ? sel.add(id) : sel.delete(id);
    const el = main.querySelector(`.op[data-id="${id}"]`); if (!el) return;
    el.classList.toggle('marcada', sim); el.querySelector('.marca').checked = sim;
  };
  main.querySelectorAll('.op').forEach(el => el.onclick = () => { marcar(el.dataset.id, !sel.has(el.dataset.id)); conta(); });
  main.querySelectorAll('[data-todos]').forEach(b => b.onclick = () => { const ids = idsDa(b.dataset.todos), todas = ids.every(i => sel.has(i)); ids.forEach(i => marcar(i, !todas)); conta(); });
  $('#sairSel').onclick = sair;
  $('#moverPara').onchange = async e => {
    const st = e.target.value; if (!st || !sel.size) return;
    try { await q(sb.from('crm_entregas').update({ status: st, atualizado_em: new Date().toISOString() }).in('id', [...sel])); toast(`${sel.size} peça(s) em ${rotulo(STATUS_ENT, st)}`); } catch { }
    sair();
  };
  $('#apagarSel').onclick = async () => {
    const n = sel.size;
    if (!await confirma(`Apagar ${n === 1 ? '1 peça' : n + ' peças'}? Os arquivos delas também são apagados, e não dá para desfazer.`)) return;
    try { await apagarEntregas([...sel]); toast(n === 1 ? 'Peça apagada' : `${n} peças apagadas`); } catch { }
    sair();
  };
  conta();
}
