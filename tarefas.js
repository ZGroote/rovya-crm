// TAREFAS: avulsas ou ligadas a projeto/cliente. Nada muda sozinho: só a Sabrina conclui, edita ou apaga.
import { sb, $, main, esc, hoje, diaLocal, dataBR, venceu, toast, q, rotulo, formulario, confirma, listaClientes, opcoesClientes, salvar, comPendentes, campos, avisoNotificacoes } from './util.js';

const PRIORIDADES = [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']];
const STATUS = [['a_fazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feita', 'Feita']];
const COR_PRI = { baixa: '', media: 'p-a_fazer', alta: 'p-revisao' };
const PESO_PRI = { alta: 0, media: 1, baixa: 2 };
const SEL = '*,crm_projetos(id,nome),crm_clientes(id,nome,empresa)';
const linkSeguro = u => /^https?:\/\//i.test(u || '');
// lembrete: o banco guarda o instante (timestamptz); o campo datetime-local mostra e devolve a hora do aparelho
const paraCampo = iso => { if (!iso) return ''; const d = new Date(iso); return new Date(d - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 16); };
const horaLembrete = iso => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

/* ---------- linha reutilizável (lista, aba do projeto, Início) ---------- */
export function linhaTarefa(t) {
  const feita = t.status === 'feita', c = t.crm_clientes;
  const meta = [
    t.projeto_id && t.crm_projetos ? `<a href="#/projeto/${esc(t.projeto_id)}">${esc(t.crm_projetos.nome)}</a>` : '',
    t.cliente_id && c ? `<a href="#/cliente/${esc(t.cliente_id)}">${esc(c.empresa || c.nome)}</a>` : '',
    feita && t.concluida_em ? 'feita ' + dataBR(t.concluida_em) : '',
  ].filter(Boolean).join(' · ');
  return `<li data-tarefa="${esc(t.id)}" style="cursor:pointer${feita ? ';opacity:.55' : ''}">
    <input type="checkbox" data-feita="${esc(t.id)}" ${feita ? 'checked' : ''} title="${feita ? 'Reabrir' : 'Concluir'}" style="width:18px;height:18px;flex:none;cursor:pointer">
    <div class="cresce"><b${feita ? ' style="text-decoration:line-through"' : ''}>${esc(t.titulo)}</b>${meta ? `<small>${meta}</small>` : ''}</div>
    ${linkSeguro(t.link) ? `<a href="${esc(t.link)}" target="_blank" rel="noopener" title="Abrir anexo">🔗</a>` : ''}
    ${t._pendente ? '<span class="pill pend" title="Guardado neste aparelho; vai para o banco quando a internet voltar">⏳</span>' : ''}
    ${t.lembrete && !t.lembrete_enviado && !feita ? `<span class="mute" title="Lembrete: chega como notificação nos aparelhos que ativaram">🔔 ${horaLembrete(t.lembrete)}</span>` : ''}
    ${t.status === 'fazendo' ? '<span class="pill p-produzindo">Fazendo</span>' : ''}
    <span class="pill ${COR_PRI[t.prioridade] || ''}">${esc(rotulo(PRIORIDADES, t.prioridade))}</span>
    ${t.prazo ? `<span class="${venceu(t.prazo) && !feita ? 'atrasado' : 'mute'}">${dataBR(t.prazo)}</span>` : ''}
  </li>`;
}

export function ligarLinhas(el, lista, depois) {
  el.querySelectorAll('[data-feita]').forEach(cb => cb.onchange = async () => {
    const t = lista.find(x => x.id === cb.dataset.feita), dados = cb.checked ? { status: 'feita', concluida_em: hoje() } : { status: 'a_fazer', concluida_em: null };
    if (await salvar({ tabela: 'crm_tarefas', acao: 'update', id: t.id, dados, antes: campos(t, ['status']), rotulo: `Tarefa “${t.titulo}”` }) === true) toast(cb.checked ? 'Tarefa concluída' : 'Tarefa reaberta');
    depois();
  });
  el.querySelectorAll('[data-tarefa]').forEach(li => li.onclick = async ev => {
    if (ev.target.closest('a,input')) return;
    if (await editarTarefa(lista.find(t => t.id === li.dataset.tarefa))) depois();
  });
}

/* ---------- formulário ---------- */
async function formTarefa(titulo, val, extra = '') {
  // sem internet o formulário abre mesmo sem as listas (vêm da cópia do aparelho quando houver)
  const [cs, ps] = await Promise.all([listaClientes().catch(() => []), projetosAtivos().catch(() => [])]);
  if (val.projeto_id && !ps.some(p => p.id === val.projeto_id)) ps.push({ id: val.projeto_id, nome: val.crm_projetos?.nome || 'Projeto atual', cliente_id: val.cliente_id });
  if (val.cliente_id && !cs.some(c => c.id === val.cliente_id)) cs.push({ id: val.cliente_id, nome: val.crm_clientes?.nome || 'Cliente atual' });
  const v = await formulario(titulo, [
    { k: 'titulo', l: 'Tarefa', req: true },
    { k: 'descricao', l: 'Descrição', t: 'textarea', linhas: 4 },
    { k: 'prioridade', l: 'Prioridade', t: 'select', o: PRIORIDADES, meia: true }, { k: 'status', l: 'Status', t: 'select', o: STATUS, meia: true },
    { k: 'prazo', l: 'Prazo', t: 'date', meia: true }, { k: 'lembrete', l: 'Lembrete (dia e hora)', t: 'datetime-local', meia: true },
    { k: 'link', l: 'Anexo (link do Drive, Canva…)' },
    { k: 'projeto_id', l: 'Projeto (opcional)', t: 'select', o: [['', '— nenhum —'], ...ps.map(p => [p.id, p.nome])] },
    { k: 'cliente_id', l: 'Cliente (opcional; se escolher projeto, vale o cliente dele)', t: 'select', o: [['', '— nenhum —'], ...opcoesClientes(cs)] },
  ], { ...val, lembrete: paraCampo(val.lembrete) }, extra);
  if (v) v.lembrete = v.lembrete ? new Date(v.lembrete).toISOString() : null;
  if (v?.projeto_id) v.cliente_id = ps.find(p => p.id === v.projeto_id)?.cliente_id ?? v.cliente_id;
  return v;
}

export async function novaTarefa(val = {}) {
  const v = await formTarefa('Nova tarefa', { prioridade: 'media', status: 'a_fazer', ...val });
  if (!v) return null;
  if (v.status === 'feita') v.concluida_em = hoje();
  const r = await salvar({ tabela: 'crm_tarefas', acao: 'insert', dados: v, rotulo: `Tarefa “${v.titulo}”` });
  if (r === true) toast('Tarefa criada'); return true;
}

// devolve true se algo mudou
export async function editarTarefa(t) {
  const v = await formTarefa('Editar tarefa', t, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar tarefa</button>');
  if ($('#dlg').returnValue === 'apagar') {
    if (!await confirma(`Apagar a tarefa “${t.titulo}”?`)) return false;
    if (await salvar({ tabela: 'crm_tarefas', acao: 'delete', id: t.id, rotulo: `Tarefa “${t.titulo}”` }) === true) toast('Tarefa apagada'); return true;
  }
  if (!v) return false;
  v.concluida_em = v.status !== 'feita' ? null : t.status === 'feita' ? t.concluida_em : hoje();
  if (await salvar({ tabela: 'crm_tarefas', acao: 'update', id: t.id, dados: v, antes: campos(t, Object.keys(v)), rotulo: `Tarefa “${t.titulo}”` }) === true) toast('Tarefa salva'); return true;
}

/* ---------- tela #/tarefas ---------- */
const porPrazo = (a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999') || PESO_PRI[a.prioridade] - PESO_PRI[b.prioridade];
const grupoHtml = (titulo, l, vazio) => `<section class="card" style="margin-bottom:16px"><h3>${titulo}${l.length ? ` <small class="mute">· ${l.length}</small>` : ''}</h3>
  <ul class="lista">${l.map(linhaTarefa).join('') || `<li class="vazio">${vazio}</li>`}</ul></section>`;

export async function tarefas(filtro = 'abertas') {
  const ts = comPendentes('crm_tarefas', await q(filtro === 'feitas'
    ? sb.from('crm_tarefas').select(SEL).eq('status', 'feita').order('concluida_em', { ascending: false, nullsFirst: false }).limit(50)
    : sb.from('crm_tarefas').select(SEL).neq('status', 'feita')), t => (t.status === 'feita') === (filtro === 'feitas'));
  const h = hoje();
  let corpo;
  if (filtro === 'feitas') corpo = grupoHtml('Feitas recentemente', ts, 'Nenhuma tarefa concluída ainda.');
  else {
    ts.sort(porPrazo);
    corpo = grupoHtml('Atrasadas e hoje', ts.filter(t => t.prazo && t.prazo <= h), 'Nada atrasado nem para hoje.')
      + grupoHtml('Próximas', ts.filter(t => t.prazo > h), 'Nenhuma tarefa com prazo à frente.')
      + grupoHtml('Sem prazo', ts.filter(t => !t.prazo), 'Nenhuma tarefa sem prazo.');
  }
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Produção</div><h1>Tarefas</h1></div><div class="acoes"><span class="acoes" id="avisos"></span><button class="bt" id="nTarefa">+ Tarefa</button></div></div>
    <div class="tabs">${[['abertas', 'Abertas'], ['feitas', 'Feitas']].map(([k, l]) => `<button data-f="${k}" class="${k === filtro ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${corpo}`;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => tarefas(b.dataset.f));
  $('#nTarefa').onclick = async () => { if (await novaTarefa()) tarefas(filtro); };
  ligarLinhas(main, ts, () => tarefas(filtro));
  avisoNotificacoes();
}

/* ---------- aba "Tarefas" do projeto ---------- */
export async function abaTarefas(p, el) {
  const ts = comPendentes('crm_tarefas', await q(sb.from('crm_tarefas').select(SEL).eq('projeto_id', p.id)), t => t.projeto_id === p.id);
  const abertas = ts.filter(t => t.status !== 'feita').sort(porPrazo);
  const feitas = ts.filter(t => t.status === 'feita').sort((a, b) => (b.concluida_em || '').localeCompare(a.concluida_em || ''));
  el.innerHTML = `<div class="card"><div class="acoes" style="justify-content:flex-end;margin-bottom:8px"><button class="bt peq" data-nova-tarefa>+ Tarefa</button></div>
    <ul class="lista">${[...abertas, ...feitas].map(linhaTarefa).join('') || '<li class="vazio">Nenhuma tarefa neste projeto.</li>'}</ul></div>`;
  const recarregar = () => abaTarefas(p, el);
  el.querySelector('[data-nova-tarefa]').onclick = async () => { if (await novaTarefa({ projeto_id: p.id, cliente_id: p.cliente_id, crm_projetos: { nome: p.nome } })) recarregar(); };
  ligarLinhas(el, ts, recarregar);
}

/* ---------- para o Início ---------- */
export const tarefasDaSemana = async () => comPendentes('crm_tarefas', await q(sb.from('crm_tarefas').select(SEL).neq('status', 'feita')
  .or(`prazo.lte.${diaLocal(7)},and(prazo.is.null,prioridade.eq.alta)`)
  .order('prazo', { ascending: true, nullsFirst: false })), t => t.status !== 'feita' && (t.prazo ? t.prazo <= diaLocal(7) : t.prioridade === 'alta'))
  .sort((a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999'));
// mesma consulta do formulário: a cópia completa (app.js) chama para ela ficar salva no aparelho
export const projetosAtivos = () => q(sb.from('crm_projetos').select('id,nome,cliente_id').eq('status', 'ativo').order('nome'));
