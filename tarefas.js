// TAREFAS: avulsas ou ligadas a projeto/cliente. Nada muda sozinho: só a Sabrina conclui, edita ou apaga.
import { sb, $, main, esc, hoje, diaLocal, dataBR, venceu, toast, q, rotulo, formulario, confirma, listaClientes, opcoesClientes } from './util.js';

const PRIORIDADES = [['baixa', 'Baixa'], ['media', 'Média'], ['alta', 'Alta']];
const STATUS = [['a_fazer', 'A fazer'], ['fazendo', 'Fazendo'], ['feita', 'Feita']];
const COR_PRI = { baixa: '', media: 'p-a_fazer', alta: 'p-revisao' };
const PESO_PRI = { alta: 0, media: 1, baixa: 2 };
const SEL = '*,crm_projetos(id,nome),crm_clientes(id,nome,empresa)';
const linkSeguro = u => /^https?:\/\//i.test(u || '');

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
    ${t.status === 'fazendo' ? '<span class="pill p-produzindo">Fazendo</span>' : ''}
    <span class="pill ${COR_PRI[t.prioridade] || ''}">${esc(rotulo(PRIORIDADES, t.prioridade))}</span>
    ${t.prazo ? `<span class="${venceu(t.prazo) && !feita ? 'atrasado' : 'mute'}">${dataBR(t.prazo)}</span>` : ''}
  </li>`;
}

export function ligarLinhas(el, lista, depois) {
  el.querySelectorAll('[data-feita]').forEach(cb => cb.onchange = async () => {
    await q(sb.from('crm_tarefas').update(cb.checked ? { status: 'feita', concluida_em: hoje() } : { status: 'a_fazer', concluida_em: null }).eq('id', cb.dataset.feita));
    toast(cb.checked ? 'Tarefa concluída' : 'Tarefa reaberta'); depois();
  });
  el.querySelectorAll('[data-tarefa]').forEach(li => li.onclick = async ev => {
    if (ev.target.closest('a,input')) return;
    if (await editarTarefa(lista.find(t => t.id === li.dataset.tarefa))) depois();
  });
}

/* ---------- formulário ---------- */
async function formTarefa(titulo, val, extra = '') {
  const [cs, ps] = await Promise.all([
    listaClientes(),
    q(val.projeto_id ? sb.from('crm_projetos').select('id,nome,cliente_id').or(`status.eq.ativo,id.eq.${val.projeto_id}`).order('nome')
      : sb.from('crm_projetos').select('id,nome,cliente_id').eq('status', 'ativo').order('nome')),
  ]);
  const v = await formulario(titulo, [
    { k: 'titulo', l: 'Tarefa', req: true },
    { k: 'descricao', l: 'Descrição', t: 'textarea', linhas: 4 },
    { k: 'prioridade', l: 'Prioridade', t: 'select', o: PRIORIDADES, meia: true }, { k: 'status', l: 'Status', t: 'select', o: STATUS, meia: true },
    { k: 'prazo', l: 'Prazo', t: 'date', meia: true }, { k: 'link', l: 'Anexo (link do Drive, Canva…)', meia: true },
    { k: 'projeto_id', l: 'Projeto (opcional)', t: 'select', o: [['', '— nenhum —'], ...ps.map(p => [p.id, p.nome])] },
    { k: 'cliente_id', l: 'Cliente (opcional; se escolher projeto, vale o cliente dele)', t: 'select', o: [['', '— nenhum —'], ...opcoesClientes(cs)] },
  ], val, extra);
  if (v?.projeto_id) v.cliente_id = ps.find(p => p.id === v.projeto_id)?.cliente_id ?? v.cliente_id;
  return v;
}

export async function novaTarefa(val = {}) {
  const v = await formTarefa('Nova tarefa', { prioridade: 'media', status: 'a_fazer', ...val });
  if (!v) return null;
  if (v.status === 'feita') v.concluida_em = hoje();
  const [t] = await q(sb.from('crm_tarefas').insert(v).select('id'));
  toast('Tarefa criada'); return t.id;
}

// devolve true se algo mudou
export async function editarTarefa(t) {
  const v = await formTarefa('Editar tarefa', t, '<button class="bt fantasma" value="apagar" formnovalidate style="justify-self:start;color:var(--bad)">Apagar tarefa</button>');
  if ($('#dlg').returnValue === 'apagar') {
    if (!await confirma(`Apagar a tarefa “${t.titulo}”?`)) return false;
    await q(sb.from('crm_tarefas').delete().eq('id', t.id)); toast('Tarefa apagada'); return true;
  }
  if (!v) return false;
  v.concluida_em = v.status !== 'feita' ? null : t.status === 'feita' ? t.concluida_em : hoje();
  await q(sb.from('crm_tarefas').update(v).eq('id', t.id)); toast('Tarefa salva'); return true;
}

/* ---------- tela #/tarefas ---------- */
const porPrazo = (a, b) => (a.prazo || '9999').localeCompare(b.prazo || '9999') || PESO_PRI[a.prioridade] - PESO_PRI[b.prioridade];
const grupoHtml = (titulo, l, vazio) => `<section class="card" style="margin-bottom:16px"><h3>${titulo}${l.length ? ` <small class="mute">· ${l.length}</small>` : ''}</h3>
  <ul class="lista">${l.map(linhaTarefa).join('') || `<li class="vazio">${vazio}</li>`}</ul></section>`;

export async function tarefas(filtro = 'abertas') {
  const ts = await q(filtro === 'feitas'
    ? sb.from('crm_tarefas').select(SEL).eq('status', 'feita').order('concluida_em', { ascending: false, nullsFirst: false }).limit(50)
    : sb.from('crm_tarefas').select(SEL).neq('status', 'feita'));
  const h = hoje();
  let corpo;
  if (filtro === 'feitas') corpo = grupoHtml('Feitas recentemente', ts, 'Nenhuma tarefa concluída ainda.');
  else {
    ts.sort(porPrazo);
    corpo = grupoHtml('Atrasadas e hoje', ts.filter(t => t.prazo && t.prazo <= h), 'Nada atrasado nem para hoje.')
      + grupoHtml('Próximas', ts.filter(t => t.prazo > h), 'Nenhuma tarefa com prazo à frente.')
      + grupoHtml('Sem prazo', ts.filter(t => !t.prazo), 'Nenhuma tarefa sem prazo.');
  }
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Produção</div><h1>Tarefas</h1></div><button class="bt" id="nTarefa">+ Tarefa</button></div>
    <div class="tabs">${[['abertas', 'Abertas'], ['feitas', 'Feitas']].map(([k, l]) => `<button data-f="${k}" class="${k === filtro ? 'on' : ''}">${l}</button>`).join('')}</div>
    ${corpo}`;
  main.querySelectorAll('[data-f]').forEach(b => b.onclick = () => tarefas(b.dataset.f));
  $('#nTarefa').onclick = async () => { if (await novaTarefa()) tarefas(filtro); };
  ligarLinhas(main, ts, () => tarefas(filtro));
}

/* ---------- aba "Tarefas" do projeto ---------- */
export async function abaTarefas(p, el) {
  const ts = await q(sb.from('crm_tarefas').select(SEL).eq('projeto_id', p.id));
  const abertas = ts.filter(t => t.status !== 'feita').sort(porPrazo);
  const feitas = ts.filter(t => t.status === 'feita').sort((a, b) => (b.concluida_em || '').localeCompare(a.concluida_em || ''));
  el.innerHTML = `<div class="card"><div class="acoes" style="justify-content:flex-end;margin-bottom:8px"><button class="bt peq" data-nova-tarefa>+ Tarefa</button></div>
    <ul class="lista">${[...abertas, ...feitas].map(linhaTarefa).join('') || '<li class="vazio">Nenhuma tarefa neste projeto.</li>'}</ul></div>`;
  const recarregar = () => abaTarefas(p, el);
  el.querySelector('[data-nova-tarefa]').onclick = async () => { if (await novaTarefa({ projeto_id: p.id, cliente_id: p.cliente_id })) recarregar(); };
  ligarLinhas(el, ts, recarregar);
}

/* ---------- para o Início ---------- */
export const tarefasDaSemana = () => q(sb.from('crm_tarefas').select(SEL).neq('status', 'feita')
  .or(`prazo.lte.${diaLocal(7)},and(prazo.is.null,prioridade.eq.alta)`)
  .order('prazo', { ascending: true, nullsFirst: false }));
