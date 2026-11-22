// Próximos passos do fluxo (cartão do Início): proposta → contrato → projeto/mês → aprovação → publicação → renovação.
// Nada aqui grava sozinho: cada linha mostra o que ficou pela metade e um botão que abre o formulário de sempre, já preenchido.
// A lista é calculada na hora (nenhuma tabela nova); some quando o passo é feito. Também pega o que ficou pela metade quando um
// formulário foi cancelado (ex.: arrastou para "Fechado" e cancelou o projeto).
import { sb, esc, hoje, diaLocal, dataBR, q } from './util.js';
import { novoContrato, mesesQueFaltam } from './contratos.js';
import { novaProposta } from './comercial.js';
import { criarMesDoContrato, rotuloMes } from './conteudo.js';

const JANELA = 120;              // dias: proposta aprovada / funil fechado mais antigos que isso não aparecem
const ESPERA_APROVACAO = 3;      // dias com peça enviada sem resposta do cliente
const nome = c => c?.empresa || c?.nome || 'Rovya';
const dias = ts => Math.floor((Date.now() - new Date(ts)) / 864e5);
// criarProjeto mora no app.js: pede por evento e espera o formulário terminar (o app.js põe a promessa em detail.pronto)
const criarProjeto = d => { dispatchEvent(new CustomEvent('crm:criar-projeto', { detail: d })); return d.pronto; };
const zap = (c, texto) => `https://wa.me/${c?.telefone ? c.telefone.replace(/\D/g, '').replace(/^(?!55)/, '55') : ''}?text=${encodeURIComponent(texto)}`;

export async function pendenciasFluxo() {
  const desde = diaLocal(-JANELA);
  const [props, ks, projs, ops, ents, acessos] = await Promise.all([
    q(sb.from('crm_propostas').select('id,grupo,versao,titulo,valor,status,cliente_id,oportunidade_id,renova_contrato,criado_em,aceite_em,crm_clientes(id,nome,empresa)').gte('criado_em', desde)),
    q(sb.from('crm_contratos').select('id,titulo,tipo,status,cliente_id,proposta_id,projeto_id,posts_mes,ajustes_inclusos,valor_mensal,valor_avulso,inicio,fim,aviso_dias,crm_clientes(id,nome,empresa)').in('status', ['rascunho', 'assinatura', 'vigente'])),
    q(sb.from('crm_projetos').select('id,cliente_id,oportunidade_id,contrato_id,mes,status').neq('status', 'arquivado')),
    q(sb.from('crm_oportunidades').select('id,titulo,cliente_id,valor,etapa,fechado_em,crm_clientes(id,nome,empresa)').eq('etapa', 'ganho').gte('fechado_em', desde)),
    q(sb.from('crm_entregas').select('id,titulo,status,prazo,revisoes,atualizado_em,crm_etapas!inner(consulta,crm_projetos!inner(id,nome,status,cliente_id,contrato_id,crm_clientes(id,nome,empresa,telefone)))')
      .in('status', ['enviado', 'revisao', 'aprovado']).eq('crm_etapas.crm_projetos.status', 'ativo')),
    sb.from('crm_portal').select('cliente_id,ultimo_acesso').then(r => r.data || [], () => []),
  ]);
  const out = [], h = hoje(), amanha = diaLocal(1);

  // 1) proposta aprovada (aceita online ou marcada) sem contrato
  const ultimas = Object.values(props.reduce((m, p) => ((!m[p.grupo] || p.versao > m[p.grupo].versao) && (m[p.grupo] = p), m), {}));
  const gruposComContrato = new Set(ks.map(k => props.find(p => p.id === k.proposta_id)?.grupo).filter(Boolean));
  for (const p of ultimas.filter(p => p.status === 'aprovada' && !gruposComContrato.has(p.grupo) && !ks.some(k => k.proposta_id === p.id)))
    out.push({ icone: '✍', titulo: `${p.aceite_em ? 'Proposta aceita online' : 'Proposta aprovada'}: falta o contrato`, sub: `${nome(p.crm_clientes)} · ${p.titulo}`,
      botao: 'Criar contrato', fazer: () => novoContrato({ cliente_id: p.cliente_id, proposta_id: p.id, titulo: p.titulo, valor_avulso: p.valor }) });

  // 2) contrato sem projeto (os mensais têm os meses, abaixo)
  const temProjeto = k => k.projeto_id || projs.some(j => j.contrato_id === k.id);
  for (const k of ks.filter(k => ['assinatura', 'vigente'].includes(k.status) && !(k.tipo !== 'avulso' && k.posts_mes) && !temProjeto(k)))
    out.push({ icone: '▦', titulo: 'Contrato sem projeto', sub: `${nome(k.crm_clientes)} · ${k.titulo}`, botao: 'Criar projeto',
      fazer: () => criarProjeto({ cliente_id: k.cliente_id, nome: k.titulo, valor: k.valor_avulso ?? k.valor_mensal, contrato_id: k.id }) });

  // 3) fechado no funil sem projeto (e sem proposta aprovada: aí o caminho é o 1)
  for (const o of ops.filter(o => !projs.some(j => j.oportunidade_id === o.id) && !props.some(p => p.oportunidade_id === o.id && p.status === 'aprovada')))
    out.push({ icone: '▦', titulo: 'Fechado no funil, sem projeto', sub: `${nome(o.crm_clientes)} · ${o.titulo}`, botao: 'Criar projeto',
      fazer: () => criarProjeto({ cliente_id: o.cliente_id, nome: o.titulo, valor: o.valor, oportunidade_id: o.id }) });

  // 4) contrato mensal sem o mês atual (ou o próximo, a partir do dia 20)
  for (const k of ks) for (const m of mesesQueFaltam(k, projs.filter(j => j.contrato_id === k.id).map(j => j.mes)))
    out.push({ icone: '▤', titulo: `Criar ${rotuloMes(m)}`, sub: `${nome(k.crm_clientes)} · ${k.posts_mes} posts · ${k.titulo}`, botao: 'Criar mês',
      fazer: async () => { location.hash = '#/projeto/' + await criarMesDoContrato(k, m); }, mes: m, contrato: k });

  // 5) cliente sem aprovar há dias (por cliente), com o último acesso ao portal
  const paraCliente = ents.filter(x => x.status === 'enviado' && !x.crm_etapas.consulta && x.crm_etapas.crm_projetos.cliente_id && dias(x.atualizado_em) >= ESPERA_APROVACAO);
  const porCliente = paraCliente.reduce((m, x) => ((m[x.crm_etapas.crm_projetos.cliente_id] ||= []).push(x), m), {});
  for (const [cid, xs] of Object.entries(porCliente)) {
    const c = xs[0].crm_etapas.crm_projetos.crm_clientes, acesso = acessos.filter(a => a.cliente_id === cid).map(a => a.ultimo_acesso).filter(Boolean).sort().at(-1);
    const n = xs.length, maior = Math.max(...xs.map(x => dias(x.atualizado_em)));
    out.push({ icone: '⏳', titulo: `${n} ${n > 1 ? 'peças esperando' : 'peça esperando'} aprovação há ${maior} dias`,
      sub: `${nome(c)} · ${acesso ? `entrou no portal ${dias(acesso) ? `há ${dias(acesso)} dia(s)` : 'hoje'}` : acessos.some(a => a.cliente_id === cid) ? 'ainda não entrou no portal' : 'sem acesso ao portal'}`,
      botao: 'Lembrar no WhatsApp', href: zap(c, `Oi, ${(c?.nome || '').split(' ')[0]}! Tem ${n} conteúdo(s) esperando a sua aprovação no portal: https://rovyacreative.com.br/portal`) });
  }

  // 6) ajuste além do combinado (peça ainda em andamento que passou das rodadas do contrato)
  const incl = Object.fromEntries(ks.filter(k => k.ajustes_inclusos != null).map(k => [k.id, k.ajustes_inclusos]));
  const alem = ents.filter(x => x.status !== 'aprovado' && incl[x.crm_etapas.crm_projetos.contrato_id] != null && x.revisoes > incl[x.crm_etapas.crm_projetos.contrato_id]);
  for (const xs of Object.values(alem.reduce((m, x) => ((m[x.crm_etapas.crm_projetos.id] ||= []).push(x), m), {}))) { // um aviso por projeto
    const pj = xs[0].crm_etapas.crm_projetos, n = incl[pj.contrato_id];
    out.push({ icone: '↺', titulo: xs.length === 1 ? `Ajuste além do combinado: ${xs[0].revisoes}ª rodada (contrato inclui ${n})` : `${xs.length} peças com ajuste além do combinado (contrato inclui ${n})`,
      sub: `${nome(pj.crm_clientes)} · ${xs.length === 1 ? xs[0].titulo : pj.nome}`, botao: 'Abrir projeto', href: '#/projeto/' + pj.id });
  }

  // 7) aprovado para publicar hoje ou amanhã
  for (const x of ents.filter(x => x.status === 'aprovado' && !x.crm_etapas.consulta && (x.prazo === h || x.prazo === amanha)).sort((a, b) => a.prazo.localeCompare(b.prazo)))
    out.push({ icone: '➚', titulo: `Publicar ${x.prazo === h ? 'hoje' : 'amanhã'}: ${x.titulo}`, sub: `${nome(x.crm_etapas.crm_projetos.crm_clientes)} · aprovado`, botao: 'Abrir projeto', href: '#/projeto/' + x.crm_etapas.crm_projetos.id });

  // 8) contrato perto do fim sem proposta de renovação
  // só uma proposta ligada a ESTE contrato (renova_contrato) tira o aviso; proposta de outro serviço do mesmo cliente não conta
  for (const k of ks.filter(k => k.status === 'vigente' && k.fim && k.fim <= diaLocal(k.aviso_dias ?? 30))) {
    if (props.some(p => p.renova_contrato === k.id && p.status !== 'recusada')) continue;
    out.push({ icone: '⟳', titulo: `Contrato ${k.fim < h ? 'venceu' : 'vence'} ${dataBR(k.fim)}: preparar renovação`, sub: `${nome(k.crm_clientes)} · ${k.titulo}`, botao: 'Preparar proposta',
      fazer: () => novaProposta({ cliente_id: k.cliente_id, titulo: 'Renovação · ' + k.titulo, renova_contrato: k.id }) });
  }
  return out;
}

export function cartaoFluxo(itens) {
  if (!itens.length) return '';
  const meses = itens.filter(i => i.mes);
  return `<section class="card" id="cFluxo" style="margin-bottom:18px"><div class="topo" style="margin:0 0 6px;align-items:center"><h3>Próximos passos</h3>
      ${meses.length > 1 ? `<button class="bt peq sec" id="todosMeses">Criar os ${meses.length} meses</button>` : ''}</div>
    <ul class="lista">${itens.map((i, n) => `<li><span class="mute" style="min-width:20px">${i.icone}</span><div class="cresce"><b>${esc(i.titulo)}</b><small>${esc(i.sub)}</small></div>
      ${i.href ? `<a class="bt peq sec" href="${esc(i.href)}" ${i.href.startsWith('http') ? 'target="_blank" rel="noopener"' : ''}>${esc(i.botao)}</a>` : `<button class="bt peq sec" data-fluxo="${n}">${esc(i.botao)}</button>`}</li>`).join('')}</ul></section>`;
}

export function ligarFluxo(el, itens, recarregar) {
  if (!el) return;
  el.querySelectorAll('[data-fluxo]').forEach(b => b.onclick = async () => {
    b.disabled = true;
    try { await itens[b.dataset.fluxo].fazer(); } catch { } // q() já mostrou o erro
    if (['', '#', '#/', '#/inicio'].includes(location.hash)) recarregar(); else b.disabled = false; // ainda no Início: atualiza a lista
  });
  const todos = el.querySelector('#todosMeses');
  if (todos) todos.onclick = async () => {
    todos.disabled = true;
    for (const i of itens.filter(i => i.mes)) { try { await criarMesDoContrato(i.contrato, i.mes); } catch { } }
    recarregar();
  };
}
