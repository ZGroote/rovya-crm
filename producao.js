// PRODUÇÃO: todas as peças (entregas) dos projetos ativos, por status. Só a Sabrina muda o status e aprova (arrastando ou no select).
import { sb, $, main, esc, dataBR, diaLocal, venceu, toast, q, rotulo } from './util.js';

export const STATUS_ENT = [['a_fazer', 'A fazer'], ['produzindo', 'Em produção'], ['enviado', 'Enviado'], ['revisao', 'Em revisão'], ['aprovado', 'Aprovado']];
export const FORMATOS = ['Post feed', 'Carrossel', 'Reels / vídeo', 'Stories', 'PDF / documento', 'Apresentação', 'Logo / identidade', 'Texto', 'Impresso', 'Site / página'];

// selo curto da peça: formato e revisões (R2 = voltou duas vezes para revisão)
export const seloPeca = x => [x.formato ? `<span class="pill">${esc(x.formato)}</span>` : '', x.revisoes ? `<span class="pill p-revisao" title="${x.revisoes} rodada(s) de revisão">R${x.revisoes}</span>` : ''].join(' ');

export async function producao(abrirEntrega, projetoId = '') {
  const es = await q(sb.from('crm_entregas').select('*,crm_anexos(id),crm_etapas!inner(titulo,crm_projetos!inner(id,nome,status,crm_clientes(id,nome,empresa)))')
    .eq('crm_etapas.crm_projetos.status', 'ativo').order('prazo', { nullsFirst: false }));
  const projs = [...new Map(es.map(x => [x.crm_etapas.crm_projetos.id, x.crm_etapas.crm_projetos])).values()];
  const desde = diaLocal(-30); // aprovadas há mais de 30 dias saem do quadro (continuam no projeto)
  const vis = es.filter(x => (!projetoId || x.crm_etapas.crm_projetos.id === projetoId) && (x.status !== 'aprovado' || (x.aprovado_em || '') >= desde));
  const nome = p => p.crm_clientes?.empresa || p.crm_clientes?.nome || p.nome;
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Operação</div><h1>Produção</h1><p>Todas as peças dos projetos ativos. Arraste entre as colunas ou abra a peça para mudar o status, o formato e anexar arquivos.</p></div>
    <select class="busca" id="filtroProj" style="min-width:0"><option value="">Todos os projetos</option>${projs.map(p => `<option value="${p.id}" ${p.id === projetoId ? 'selected' : ''}>${esc(nome(p))} · ${esc(p.nome)}</option>`).join('')}</select></div>
    ${es.length ? '' : '<p class="vazio">Nenhuma peça em projetos ativos. As peças são as entregas de cada etapa do projeto.</p>'}
    <div class="funil">${STATUS_ENT.map(([k, l]) => {
      const lst = vis.filter(x => x.status === k);
      return `<section class="col" data-status="${k}"><header><b>${l}</b><span>${lst.length}</span></header>
      ${lst.map(x => { const p = x.crm_etapas.crm_projetos; return `<article class="op" draggable="true" data-id="${x.id}"><b>${esc(x.titulo)}</b>
        <small>${esc(nome(p))} · ${esc(x.crm_etapas.titulo)}</small>
        <div>${seloPeca(x)} ${x.crm_anexos.length ? '<span title="Tem arquivo">📎</span>' : ''}</div>
        ${x.prazo && k !== 'aprovado' ? `<small class="${venceu(x.prazo) ? 'atrasado' : ''}">prazo ${dataBR(x.prazo)}</small>` : ''}
        ${k === 'aprovado' && x.aprovado_em ? `<small>aprovado ${dataBR(x.aprovado_em.slice(0, 10))}</small>` : ''}</article>`; }).join('')}</section>`;
    }).join('')}</div>`;
  // só redesenha se ela ainda estiver na Produção (senão o redesenho atrasado cobriria a tela para onde ela foi)
  const recarregar = () => { if (location.hash.startsWith('#/producao')) producao(abrirEntrega, projetoId); };
  $('#filtroProj').onchange = e => producao(abrirEntrega, e.target.value);
  const porId = Object.fromEntries(es.map(x => [x.id, x]));
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
