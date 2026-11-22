// Quadro de conteúdo do mês (no formato que a Sabrina usava no Trello) e importação dos quadros do Trello.
// Os dois viram um projeto comum: lista do Trello = etapa, cartão = entrega. Etapas "só consulta" o cliente lê e não aprova.
import { sb, $, esc, q, toast, formulario, funcao, semRede } from './util.js';

const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const SEMANA = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
const DIAS_POST = [1, 3, 5]; // segunda, quarta e sexta; a Sabrina muda as datas no cartão quando quiser
const dd = n => String(n).padStart(2, '0');

const COMO_USAR = `## Como usar o portal
**Para aprovar:** os conteúdos prontos esperam por você aqui. Abra, veja a arte e o texto e clique em **Aprovar** ou em **Pedir alteração** (conte o que mudar).
**Planejamento:** o quadro do mês. Cada coluna é uma semana; cada cartão, uma publicação.
**Arquivos:** tudo o que já foi entregue, para baixar.
**Solicitações:** precisa de algo novo? Peça por lá. A Rovya recebe o aviso na hora.`;

// estrutura de um mês: Planejamento Estratégico, uma coluna por semana, Radar e Guia.
// posts = quantos posts o contrato inclui; sem número, segunda, quarta e sexta. Com número, espalha pelo mês
// (seg/qua/sex quando cabe; se o contrato pede mais, usa de segunda a sábado).
export function mesDeConteudo(mes, cliente, posts = null) {
  const [a, m] = mes.split('-').map(Number), nome = MESES[m - 1], rot = nome[0].toUpperCase() + nome.slice(1) + ' ' + a;
  const empresa = (cliente?.empresa || cliente?.nome || 'Rovya').toUpperCase();
  const ultimo = new Date(a, m, 0).getDate(), dia = d => new Date(a, m - 1, d).getDay();
  const todos = Array.from({ length: ultimo }, (_, i) => i + 1), base = todos.filter(d => DIAS_POST.includes(dia(d)));
  const pool = !posts || posts <= base.length ? base : todos.filter(d => dia(d) >= 1 && dia(d) <= 6);
  const n = Math.min(posts || base.length, pool.length);
  const dias = new Set(Array.from({ length: n }, (_, i) => pool[Math.floor(i * pool.length / n)]));
  const semanas = [];
  for (const d of todos) {
    if (d === 1 || dia(d) === 1) semanas.push({ de: d, ate: d, posts: [] });
    const s = semanas.at(-1); s.ate = d;
    if (dias.has(d)) s.posts.push(d);
  }
  const cartao = d => ({ titulo: `Publicar em ${dd(d)}/${dd(m)}`, prazo: `${a}-${dd(m)}-${dd(d)}`,
    texto: `## ${empresa} | PRODUÇÃO DE CONTEÚDO\n**Data:** ${dd(d)}/${dd(m)}/${a} — ${SEMANA[new Date(a, m - 1, d).getDay()]}\n**Formato:** \n**Tema:** \n\n## Sobre o conteúdo\n{{contato}}, ` });
  return [
    { titulo: `Planejamento Estratégico — ${rot}`, consulta: true,
      entregas: ['Planejamento Estratégico', 'Pilares Editoriais e Temas Prioritários', 'Calendário Editorial', 'Direção Criativa e Identidade dos Conteúdos', 'Metas, Indicadores e Avaliação de Resultados'] },
    ...semanas.filter(s => s.posts.length).map((s, i) => ({ titulo: `Semana ${dd(i + 1)} | ${dd(s.de)}${s.ate > s.de ? ' a ' + dd(s.ate) : ''} de ${nome}`, entregas: s.posts.map(cartao) })),
    { titulo: 'Radar e Oportunidades', consulta: true, entregas: [`Radar de ${nome}`, 'Datas e Prazos Importantes', 'Dúvidas Reais do Público'] },
    { titulo: 'Guia de Publicação', consulta: true, entregas: [{ titulo: 'Como usar o portal', texto: COMO_USAR }, 'Guia de Publicação'] },
  ];
}
// cria o projeto pelo banco. O mesmo mês duas vezes no mesmo contrato (o banco recusa) vira uma mensagem clara e abre o
// projeto que já existe; qualquer outro erro do banco aparece como veio.
export async function rpcProjeto(args) {
  const { data, error } = await sb.rpc('crm_projeto_de_modelo', args);
  if (!error) return data;
  if (error.code === '23505' && args.p_contrato && args.p_mes) {
    toast('O projeto deste mês já existe para este contrato. Abrindo o projeto existente.', true);
    const [j] = await q(sb.from('crm_projetos').select('id').eq('contrato_id', args.p_contrato).eq('mes', args.p_mes));
    if (j) location.hash = '#/projeto/' + j.id;
  } else toast(semRede(error) ? 'Sem internet: isso não foi salvo. Tente de novo quando a conexão voltar.' : error.message, true);
  throw error;
}
// cria o projeto do mês de um contrato mensal (contrato + mês ficam gravados; o banco não deixa criar o mesmo mês duas vezes)
export async function criarMesDoContrato(k, mes) {
  const c = k.crm_clientes, nome = `${c?.empresa || c?.nome || 'Rovya'} · ${rotuloMes(mes)}`, [a, m] = mes.split('-').map(Number);
  const pid = await rpcProjeto({ p_cliente: k.cliente_id, p_nome: nome, p_modelo: null, p_estrutura: mesDeConteudo(mes, c, k.posts_mes),
    p_contrato: k.id, p_mes: mes, p_valor: k.valor_mensal ?? null, p_entrega: `${mes}-${dd(new Date(a, m, 0).getDate())}` }); // entrega = último dia do mês
  toast(`${rotuloMes(mes)} criado para ${c?.empresa || c?.nome}`);
  return pid;
}
export const rotuloMes = mes => { const [a, m] = mes.split('-').map(Number); return MESES[m - 1][0].toUpperCase() + MESES[m - 1].slice(1) + ' ' + a; };
export const proximoMes = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return d.toLocaleDateString('sv').slice(0, 7); };

/* ---------- importação do Trello ---------- */
const trello = async (acao, dados) => {
  try { return await funcao('crm-trello', acao, dados); }
  catch (e) { toast(semRede(e) ? 'Sem internet: precisa de conexão.' : e.message, true); return null; }
};
const COMO_CONECTAR = `<ol class="mute" style="margin:0;padding-left:18px;display:grid;gap:4px">
  <li>Entre no Trello e abra <a href="https://trello.com/power-ups/admin" target="_blank" rel="noopener">trello.com/power-ups/admin</a> → <b>Novo</b> → crie a integração “CRM Rovya” (o Workspace pode ser qualquer um).</li>
  <li>Na integração, abra <b>Chave de API</b> → <b>Gerar uma nova chave de API</b> e copie a <b>Chave</b>.</li>
  <li>Ao lado da chave, clique no link <b>Token</b> → <b>Permitir</b> e copie o token.</li></ol>
  <p class="mute" style="margin:0">Fica guardado no servidor (o navegador não vê) e só serve para ler os quadros e baixar os anexos.</p>`;
const limpar = n => n.normalize('NFD').replace(/[^\w.-]+/g, '_').slice(-120);
// descrição + checklists + anexos que são links (os arquivos vêm à parte)
const textoCartao = k => [k.desc.trim(),
  ...k.checklists.map(ch => `**${ch.nome}**\n` + ch.itens.map(i => (i.feito ? '☑ ' : '☐ ') + i.nome).join('\n')),
  ...k.anexos.filter(x => !x.upload).map(x => `Link: ${x.nome} — ${x.url}`)].filter(Boolean).join('\n\n') || null;
const diaDe = iso => iso ? new Date(iso).toLocaleDateString('sv') : null; // vencimento do Trello em UTC → dia no fuso daqui

export async function importarTrello(cliente) {
  const cfg = await trello('config'); if (!cfg) return null;
  if (!cfg.configurado) {
    const v = await formulario('Conectar o Trello (uma vez só)', [{ k: 'key', l: 'Chave (API key)', req: true }, { k: 'token', l: 'Token', req: true }], {}, COMO_CONECTAR, 'Conectar');
    if (!v) return null;
    const r = await trello('salvar', v); if (!r) return null;
    toast('Trello conectado: ' + r.nome);
  }
  const l = await formulario('Importar quadro do Trello', [{ k: 'link', l: 'Link do quadro (trello.com/b/…)', req: true }], {}, '<p class="mute" style="margin:0">Abra o quadro no Trello e copie o endereço da barra do navegador.</p>', 'Ler quadro');
  if (!l) return null;
  toast('Lendo o quadro…');
  const b = await trello('quadro', { link: l.link }); if (!b) return null;
  const arquivos = b.listas.flatMap(x => x.cartoes.flatMap(k => k.anexos.filter(a => a.upload)));
  const mb = arquivos.reduce((s, a) => s + (a.bytes || 0), 0) / 1048576;
  const listas = b.listas.map((x, i) => `<div class="dupla" style="align-items:center"><span><b>${esc(x.nome)}</b> <small class="mute">${x.cartoes.length} cartões</small></span>
    <select data-lista="${i}"><option value="aprova" ${/semana|publica/i.test(x.nome) ? 'selected' : ''}>Importar · cliente aprova</option><option value="consulta" ${/semana|publica/i.test(x.nome) ? '' : 'selected'}>Importar · só consulta</option><option value="fora">Não importar</option></select></div>`).join('');
  const pr = formulario('Importar “' + b.nome + '”', [
    { k: 'nome', l: 'Nome do projeto', req: true },
    { k: 'status', l: 'Os cartões entram como', t: 'select', o: [['aprovado', 'Aprovados (já publicados no Trello)'], ['enviado', 'Enviados (o cliente ainda vai aprovar)'], ['a_fazer', 'A fazer (o cliente só vê quando você enviar)']] }],
    { nome: b.nome }, `<div style="display:grid;gap:8px"><label style="margin:0">Colunas</label>${listas}</div>
    <p class="mute" style="margin:0">${arquivos.length ? `${arquivos.length} arquivo(s), ${mb.toFixed(1)} MB, serão copiados do Trello para o CRM.` : 'Nenhum arquivo para copiar.'} O Trello não muda.</p>`, 'Importar');
  const escolhas = [...$('#dlgf').querySelectorAll('[data-lista]')]; // o formulário some do DOM só no próximo, então lê antes de esperar
  const v = await pr; if (!v) return null;
  const modo = escolhas.map(s => s.value);
  const usadas = b.listas.filter((_, i) => modo[i] !== 'fora');
  const estrutura = b.listas.map((x, i) => modo[i] === 'fora' ? null : {
    titulo: x.nome, consulta: modo[i] === 'consulta',
    entregas: x.cartoes.map(k => ({ titulo: k.nome, texto: textoCartao(k), prazo: diaDe(k.due), status: k.feito ? 'aprovado' : v.status })),
  }).filter(Boolean);
  const pid = await q(sb.rpc('crm_projeto_de_modelo', { p_cliente: cliente?.id ?? null, p_nome: v.nome, p_modelo: null, p_estrutura: estrutura }));
  // ids das entregas criadas, na mesma ordem de colunas e cartões
  const etapas = (await q(sb.from('crm_etapas').select('ordem,crm_entregas(id,ordem)').eq('projeto_id', pid))).sort((x, y) => x.ordem - y.ordem);
  const fila = usadas.flatMap((x, i) => x.cartoes.flatMap((k, j) => {
    const eid = etapas[i]?.crm_entregas.sort((p, r) => p.ordem - r.ordem)[j]?.id;
    return eid ? k.anexos.filter(a => a.upload).map(a => ({ card: k.id, a, eid })) : [];
  }));
  let falhas = 0;
  for (const [n, { card, a, eid }] of fila.entries()) {
    toast(`Copiando arquivo ${n + 1} de ${fila.length}…`);
    const caminho = `${pid}/${eid}/${Date.now()}-${limpar(a.nome)}`;
    const r = await trello('anexo', { card, anexo: a.id, caminho });
    if (!r) { falhas++; continue; }
    await q(sb.from('crm_anexos').insert({ entrega_id: eid, nome: a.nome, caminho, tamanho: r.tamanho }));
  }
  toast(falhas ? `Importado, mas ${falhas} arquivo(s) não vieram. Confira em Configurações → Falhas.` : 'Quadro importado ✦', !!falhas);
  location.hash = '#/projeto/' + pid;
  return pid;
}
