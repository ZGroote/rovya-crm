// comercial: catálogo de serviços e propostas versionadas (tabelas crm_servicos e crm_propostas)
import { sb, $, main, esc, brl, hoje, diaLocal, dataBR, venceu, toast, q, rotulo, preencher, mdHtml, formulario, confirma, listaClientes, opcoesClientes, anexosGrandes } from './util.js';
import { novoContrato } from './contratos.js';
import { enviarAoDrive, pastaDoCliente, linhaDoc } from './drive.js';

const STATUS_PROP = [['rascunho', 'Rascunho'], ['enviada', 'Enviada'], ['aprovada', 'Aprovada'], ['recusada', 'Recusada']];
const COR_PROP = { rascunho: 'p-a_fazer', enviada: 'p-enviado', aprovada: 'p-aprovado', recusada: 'p-revisao' };
const pillProp = st => `<span class="pill ${COR_PROP[st] || ''}">${rotulo(STATUS_PROP, st)}</span>`;
// passagens permitidas (o banco confere a mesma regra: crm_proposta_trg em 024_fluxo.sql). Aceita online não volta.
const proximosProp = p => ({ rascunho: ['enviada'], enviada: ['aprovada', 'recusada'], recusada: ['enviada'], aprovada: p.aceite_em ? [] : ['enviada'] })[p.status] || [];
const BOTAO_ST = { enviada: 'Marcar enviada', aprovada: 'Aprovada', recusada: 'Recusada' };
export const LINK_PROPOSTA = 'https://rovyacreative.com.br/proposta#';
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

// devolve 'apagado', o id salvo, ou null (cancelou)
// próximo código numérico livre, com dois dígitos (04, 10, 11…)
const proximoCodigo = ts => String(Math.max(0, ...ts.map(x => parseInt(x.codigo, 10)).filter(n => !isNaN(n))) + 1).padStart(2, '0');
async function editarServico(s) {
  const todos = await q(sb.from('crm_servicos').select('id,codigo,nome'));
  let val = s || {}, erro = '', v;
  for (; ;) { // código repetido: avisa e deixa o formulário aberto (o banco recusaria com uma mensagem técnica)
    v = await formulario(s ? s.nome : 'Novo serviço', CAMPOS_SERVICO, val, (erro ? `<p class="atrasado">${esc(erro)}</p>` : '') + (s ? BT_APAGAR('Apagar serviço') : ''));
    if (!v || $('#dlg').returnValue === 'apagar') break;
    const dono = v.codigo && todos.find(x => x.codigo === v.codigo && x.id !== s?.id);
    if (!dono) break;
    erro = `Já existe um serviço com o código ${v.codigo} (${dono.nome}). Use outro, por exemplo ${proximoCodigo(todos)}.`; val = { ...val, ...v };
  }
  if ($('#dlg').returnValue === 'apagar') {
    if (!await confirma(`Apagar “${s.nome}” do catálogo, com os planos e documentos? Propostas já feitas não mudam.`)) return null;
    await q(sb.from('crm_servicos').delete().eq('id', s.id));
    if (s.arquivos?.length) await sb.storage.from('crm-anexos').remove(s.arquivos.map(a => a.caminho));
    return 'apagado';
  }
  if (!v) return null;
  v.ativo = v.ativo !== 'false'; if (v.preco != null) v.preco = r2(v.preco);
  const [r] = await q(s ? sb.from('crm_servicos').update(v).eq('id', s.id).select('id') : sb.from('crm_servicos').insert(v).select('id')); toast('Serviço salvo');
  return r?.id ?? s?.id;
}

// planos: [{nome, preco, a_partir, itens, documento}]
const precoPlano = pl => pl.preco == null ? '—' : (pl.a_partir ? 'A partir de ' : '') + brl(pl.preco);
const itensDe = pl => String(pl.itens || '').split('\n').map(x => x.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean);

export async function servicos() {
  const ss = await q(sb.from('crm_servicos').select('*').order('categoria', { nullsFirst: false }).order('nome'));
  const tabela = l => `<table><thead><tr><th>Código</th><th>Serviço</th><th class="esconde-cel">Categoria</th><th class="dir">Preço</th><th>Situação</th></tr></thead><tbody>${l.map(s => `<tr data-id="${s.id}" style="cursor:pointer">
    <td><small class="mute">${esc(s.codigo)}</small></td><td><b>${esc(s.nome)}</b>${s.descricao ? `<br><small class="mute">${esc(s.descricao)}</small>` : ''}</td>
    <td class="esconde-cel">${esc(s.categoria)}</td><td class="dir">${s.planos?.length ? `<small class="mute">${s.planos.length} plano${s.planos.length > 1 ? 's' : ''}</small>` : s.preco != null ? brl(s.preco) : '—'}</td><td>${s.ativo ? '<span class="pill p-aprovado">Ativo</span>' : '<span class="pill">Inativo</span>'}</td></tr>
    ${(s.planos || []).map(pl => `<tr data-id="${s.id}" style="cursor:pointer"><td></td><td style="padding-left:22px">${esc(pl.nome)}</td><td class="esconde-cel"></td><td class="dir">${precoPlano(pl)}</td><td></td></tr>`).join('')}`).join('')}</tbody></table>`;
  const ativos = ss.filter(s => s.ativo), inativos = ss.filter(s => !s.ativo);
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Comercial</div><h1>Serviços</h1><p>O catálogo que alimenta as propostas. Mudar aqui não altera propostas já feitas.</p></div><button class="bt" id="nServ">+ Serviço</button></div>
    <div class="card">${ativos.length ? tabela(ativos) : '<p class="vazio">Nenhum serviço ativo. Cadastre os serviços que a ROVYA vende.</p>'}</div>
    ${inativos.length ? `<h2 style="margin:28px 0 12px">Inativos</h2><div class="card" style="opacity:.6">${tabela(inativos)}</div>` : ''}`;
  main.querySelectorAll('tr[data-id]').forEach(tr => tr.onclick = () => location.hash = '#/servico/' + tr.dataset.id);
  $('#nServ').onclick = async () => { const id = await editarServico(); if (id) location.hash = '#/servico/' + id + '/planos'; };
}

/* ---------- SERVIÇO: #/servico/<id>  (abas Dados · Planos · Documentos) ---------- */
const CAMPOS_PLANO = [
  { k: 'nome', l: 'Nome do plano (ex.: Essencial, Intermediária, Avançada)', req: true },
  { k: 'preco', l: 'Preço (R$)', t: 'number', meia: true }, { k: 'a_partir', l: 'Mostrar como', t: 'select', o: [['', 'Preço fechado'], ['1', '“A partir de”']], meia: true },
  { k: 'itens', l: 'O que está incluído (um por linha)', t: 'textarea', linhas: 9 }];
const AJUDA_DOC = '<p class="mute" style="margin:0;font-size:.82rem">Dá para colar do Word. <b>## Título</b> vira título e <b>**texto**</b> vira negrito.</p>';

export async function servico(id, aba) {
  aba ||= location.hash.split('/')[3] || 'dados';
  const s = await q(sb.from('crm_servicos').select('*').eq('id', id).maybeSingle());
  if (!s) { main.innerHTML = '<p class="vazio">Serviço não encontrado.</p>'; return; }
  const planos = s.planos || [], arquivos = s.arquivos || [];
  const gravar = async v => { await q(sb.from('crm_servicos').update(v).eq('id', id)); Object.assign(s, v); };
  const bloco = (t, v) => v ? `<div><div class="eyebrow" style="margin-bottom:4px">${t}</div><div style="white-space:pre-wrap">${esc(v)}</div></div>` : '';

  const conteudo = {
    dados: () => `<section class="card" style="display:grid;gap:16px">
        <div class="acoes" style="justify-content:space-between"><div>${s.ativo ? '<span class="pill p-aprovado">Ativo</span>' : '<span class="pill">Inativo</span>'} <small class="mute">${esc([s.codigo, s.categoria].filter(Boolean).join(' · '))}</small></div><button class="bt peq sec" id="edDados">Editar dados</button></div>
        ${bloco('Descrição curta (vai para a proposta)', s.descricao)}${bloco('Escopo', s.escopo)}${bloco('Entregáveis', s.entregaveis)}
        ${planos.length ? '' : bloco('Preço base', s.preco != null ? brl(s.preco) : '')}</section>`,
    planos: () => `<div class="acoes" style="margin-bottom:14px"><button class="bt" id="nPlano">+ Plano</button><small class="mute">Clique num plano para editar. Na proposta, “+ Do catálogo” oferece cada plano com o preço e o que está incluído.</small></div>
      ${planos.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:14px">${planos.map((pl, i) => `<section class="card" data-p="${i}" style="cursor:pointer;display:grid;gap:8px;align-content:start">
        <h3 style="margin:0">${esc(pl.nome)}</h3><b style="color:var(--wine);font-size:1.15rem">${precoPlano(pl)}</b>
        ${itensDe(pl).length ? `<ul style="margin:0;padding-left:18px;display:grid;gap:3px">${itensDe(pl).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<small class="mute">Sem itens ainda.</small>'}
        ${pl.documento ? '<small class="mute">📄 tem documento</small>' : ''}</section>`).join('')}</div>`
      : '<p class="card vazio">Nenhum plano ainda. Crie, por exemplo, Essencial, Intermediária e Avançada, cada um com o preço e o que está incluído.</p>'}`,
    documentos: () => `${planos.length ? planos.map((pl, i) => `<section class="card" style="margin-bottom:14px">
        <div class="topo" style="margin-bottom:6px;align-items:center"><h3 style="margin:0">${esc(s.nome)} — ${esc(pl.nome)}</h3>
          <div class="acoes"><button class="bt peq sec" data-doc="${i}">${pl.documento ? 'Editar' : 'Escrever documento'}</button>${pl.documento ? `<button class="bt peq fantasma" data-pdf="${i}">Gerar PDF</button>` : ''}</div></div>
        ${pl.documento ? `<div class="ori"><div class="txt" style="max-height:none">${mdHtml(pl.documento)}</div></div>` : '<p class="mute" style="margin:0">Sem documento. Escreva aqui como funciona o plano (rotina mensal, semanas, reuniões…).</p>'}</section>`).join('')
      : '<p class="card vazio">Os documentos ficam em cada plano. Crie os planos primeiro, na aba Planos.</p>'}
      <section class="card"><div class="topo" style="margin-bottom:6px;align-items:center"><h3 style="margin:0">Arquivos</h3><label class="bt peq sec" style="cursor:pointer">+ Anexar arquivo<input type="file" id="arqServ" multiple hidden></label></div>
        <ul class="lista">${arquivos.map((a, i) => `<li><a href="#" data-abrir="${i}">📎 ${esc(a.nome)}</a> <small class="mute">${Math.max(1, Math.round(a.tamanho / 1024))} KB</small> <button class="bt peq fantasma" data-tirar="${i}" style="color:var(--bad)">Remover</button></li>`).join('') || '<li class="vazio">Nenhum arquivo. Anexe Word, PDF, apresentações…</li>'}</ul></section>`
  };

  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/servicos">Serviços</a></div><h1>${esc(s.nome)}</h1>${s.descricao ? `<p>${esc(s.descricao)}</p>` : ''}</div></div>
    <div class="tabs"><button data-a="dados">Dados</button><button data-a="planos">Planos${planos.length ? ' · ' + planos.length : ''}</button><button data-a="documentos">Documentos</button></div>
    <div id="aba">${(conteudo[aba] || conteudo.dados)()}</div>`;
  main.querySelectorAll('.tabs button').forEach(b => { b.classList.toggle('on', b.dataset.a === aba); b.onclick = () => servico(id, b.dataset.a); });
  const de = sel => main.querySelectorAll(sel);

  if (aba === 'dados') $('#edDados').onclick = async () => { const r = await editarServico(s); if (r === 'apagado') location.hash = '#/servicos'; else if (r) servico(id, aba); };

  const editarPlano = async i => {
    const pl = planos[i] || {};
    const v = await formulario(i < 0 ? 'Novo plano' : pl.nome, CAMPOS_PLANO, { ...pl, a_partir: pl.a_partir ? '1' : '' }, i < 0 ? '' : BT_APAGAR('Apagar plano'));
    if ($('#dlg').returnValue === 'apagar') { if (!await confirma(`Apagar o plano “${pl.nome}”${pl.documento ? ' e o documento dele' : ''}?`)) return; planos.splice(i, 1); }
    else if (!v) return;
    else { const novo = { ...pl, nome: v.nome, preco: v.preco == null ? null : r2(v.preco), a_partir: !!v.a_partir, itens: v.itens || '' }; i < 0 ? planos.push(novo) : (planos[i] = novo); }
    await gravar({ planos }); toast('Planos salvos'); servico(id, 'planos');
  };
  if (aba === 'planos') {
    $('#nPlano').onclick = () => editarPlano(-1);
    de('[data-p]').forEach(c => c.onclick = () => editarPlano(+c.dataset.p));
  }

  if (aba === 'documentos') {
    de('[data-doc]').forEach(b => b.onclick = async () => {
      const pl = planos[b.dataset.doc];
      const v = await formulario(`Documento · ${pl.nome}`, [{ k: 'documento', l: 'Texto', t: 'textarea', linhas: 18 }], pl, AJUDA_DOC);
      if (!v) return;
      pl.documento = v.documento || ''; await gravar({ planos }); toast('Documento salvo'); servico(id, 'documentos');
    });
    de('[data-pdf]').forEach(b => b.onclick = () => imprimirPlano(s, planos[b.dataset.pdf]));
    $('#arqServ').onchange = async e => {
      const fs = [...e.target.files]; e.target.value = '';
      if (!fs.length || anexosGrandes(fs)) return;
      for (const f of fs) {
        const caminho = `servicos/${id}/${Date.now()}-${f.name.normalize('NFD').replace(/[^\w.-]+/g, '_')}`;
        toast('Enviando ' + f.name + '…');
        await q(sb.storage.from('crm-anexos').upload(caminho, f));
        arquivos.push({ nome: f.name, caminho, tamanho: f.size });
      }
      await gravar({ arquivos }); toast(fs.length > 1 ? 'Arquivos anexados' : 'Arquivo anexado'); servico(id, 'documentos');
    };
    de('[data-abrir]').forEach(a => a.onclick = async e => {
      e.preventDefault();
      const { data } = await sb.storage.from('crm-anexos').createSignedUrl(arquivos[a.dataset.abrir].caminho, 3600);
      if (data?.signedUrl) open(data.signedUrl, '_blank', 'noopener'); else toast('Não consegui abrir o arquivo', true);
    });
    de('[data-tirar]').forEach(b => b.onclick = async () => {
      const a = arquivos[b.dataset.tirar];
      if (!await confirma(`Remover “${a.nome}”?`)) return;
      arquivos.splice(b.dataset.tirar, 1); await gravar({ arquivos });
      await sb.storage.from('crm-anexos').remove([a.caminho]); toast('Arquivo removido'); servico(id, 'documentos');
    });
  }
}

/* ---------- PROPOSTAS ---------- */
export async function novaProposta(val = {}) {
  const [cs, mods] = await Promise.all([listaClientes(), q(sb.from('crm_modelos').select('id,titulo,corpo').eq('tipo', 'proposta').order('titulo'))]);
  if (!cs.length) { toast('Cadastre um cliente primeiro'); return null; }
  const v = await formulario('Nova proposta', [
    { k: 'cliente_id', l: 'Cliente', t: 'select', o: [['', 'Selecione…'], ...opcoesClientes(cs)], req: true },
    { k: 'titulo', l: 'Título', req: true },
    { k: 'modelo', l: 'Começar a partir de', t: 'select', o: [...mods.map(m => [m.id, m.titulo]), ['', val.corpo ? 'Texto escrito pela assistente' : 'Em branco']] },
    { k: 'validade', l: 'Válida até', t: 'date' }],
    { modelo: val.corpo ? '' : mods[0]?.id ?? '', validade: diaLocal(15), ...val });
  if (!v) return null;
  let corpo = val.corpo || null;   // a assistente pode mandar o texto pronto
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
    q(sb.from('crm_servicos').select('id,codigo,nome,descricao,preco,planos').eq('ativo', true).order('nome'))]);
  // PDFs no Drive de todas as versões do grupo (linhaDoc mostra a versão)
  const docs = await q(sb.from('crm_documentos').select('*').in('proposta_id', vers.map(v => v.id)).order('criado_em', { ascending: false }));
  const c = p.crm_clientes, ult = vers.at(-1), ro = p.versao < ult.versao; // versões antigas = histórico, só leitura
  const itens = p.itens || [];
  const dis = ro ? 'disabled' : '';
  main.innerHTML = `<div class="topo"><div><div class="eyebrow"><a href="#/cliente/${c.id}">${esc(c.empresa || c.nome)}</a> · <a href="#/propostas">Propostas</a></div><h1 id="pTit">${esc(p.titulo)}</h1>
      <p>Proposta · ${vers.map(v => v.id === id ? `<b>v${v.versao}</b>` : `<a href="#/proposta/${v.id}">v${v.versao}</a>`).join(' · ')}${p.enviada_em ? ' · enviada ' + dataBR(p.enviada_em) : ''}</p></div>
    <div class="acoes"><select id="st" class="busca" style="min-width:0">${STATUS_PROP.filter(([k]) => k === p.status || proximosProp(p).includes(k)).map(([k, l]) => `<option value="${k}" ${k === p.status ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <button class="bt sec" id="pdf">Gerar PDF</button><button class="bt sec" id="envDrive">Enviar PDF ao Drive</button><button class="bt sec" id="nv">Nova versão</button>${ro ? '' : '<button class="bt" id="salvar">Salvar</button>'}</div></div>
    ${ro ? `<p class="card mute" style="margin:0 0 16px">Esta v${p.versao} é histórico e não se edita. Abra a <a href="#/proposta/${ult.id}">v${ult.versao}</a> ou use “Nova versão” para partir desta.</p>` : ''}
    ${p.aceite_em ? `<p class="card" style="margin:0 0 16px">✓ Aceita online por <b>${esc(p.aceite_nome)}</b> em ${new Date(p.aceite_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}${p.aceite_ip ? ` <small class="mute">(IP ${esc(p.aceite_ip)})</small>` : ''}</p>` : ''}
    ${p.status === 'enviada' && p.token && !ro ? `<section class="card" style="margin:0 0 16px"><h3>Link para o cliente aceitar</h3>
      <p class="mute" style="margin:0 0 8px">O cliente abre, lê e clica em “Aceitar proposta”. Você recebe o aviso, o funil fecha sozinho e o contrato aparece no Início para criar.</p>
      <div class="acoes"><input class="busca" id="linkProp" readonly value="${esc(LINK_PROPOSTA + p.token)}" style="flex:1;min-width:220px"><button class="bt peq sec" id="copiarLink">Copiar</button>
      <a class="bt peq sec" target="_blank" rel="noopener" href="${esc(zap(c, `Oi, ${(c.nome || '').split(' ')[0]}! Segue a proposta “${p.titulo}”. Por este link você lê tudo e, se estiver de acordo, aceita por ali mesmo: ${LINK_PROPOSTA + p.token}`))}">WhatsApp</a>
      <a class="bt peq fantasma" target="_blank" rel="noopener" href="${esc(LINK_PROPOSTA + p.token)}">Abrir ↗</a></div></section>` : ''}
    <div class="acoes" style="margin-bottom:18px">${ro ? '' : proximosProp(p).map(st => `<button class="bt peq sec" data-st="${st}">${BOTAO_ST[st]}</button>`).join('')}
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
      <section class="card"><h3>Pré-visualização</h3><div class="ori"><div class="txt" id="prev" style="max-height:none"></div></div></section></div>
    ${docs.length ? `<section class="card" style="margin-top:18px"><h3>No Drive</h3><ul class="lista">${docs.map(linhaDoc).join('')}</ul></section>` : ''}`;

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
      // serviço com planos: uma opção por plano ("id|índice"); sem planos: o serviço com o preço base
      const ops = servs.flatMap(s => { const cod = s.codigo ? s.codigo + ' · ' : '';
        return s.planos?.length ? s.planos.map((pl, i) => [s.id + '|' + i, `${cod}${s.nome} · ${pl.nome} · ${precoPlano(pl)}`]) : [[s.id, cod + s.nome + (s.preco != null ? ' · ' + brl(s.preco) : '')]]; });
      const v = await formulario('Adicionar do catálogo', [{ k: 's', l: 'Serviço', t: 'select', o: ops }, { k: 'qtd', l: 'Quantidade', t: 'number', req: true }], { qtd: 1 },
        '<label style="display:flex;gap:8px;align-items:center;text-transform:none;letter-spacing:0"><input type="checkbox" id="comDoc" checked> Colocar o documento do plano no texto da proposta (se tiver)</label>');
      if (!v) return;
      const [sid, pi] = v.s.split('|'), s = servs.find(x => x.id === sid), pl = pi != null ? s.planos[pi] : null;
      // copia: o item não acompanha mudanças futuras do catálogo
      itens.push(pl ? { servico_id: s.id, nome: `${s.nome} — ${pl.nome}`, descricao: itensDe(pl).map(x => '• ' + x).join('\n') || s.descricao || '', qtd: Number(v.qtd) || 0, preco: r2(pl.preco) }
        : { servico_id: s.id, nome: s.nome, descricao: s.descricao || '', qtd: Number(v.qtd) || 0, preco: r2(s.preco) });
      if (pl?.documento && $('#comDoc').checked) { // o diálogo continua no DOM depois de fechar
        const f = $('#fCorpo'); f.value = (f.value.trimEnd() ? f.value.trimEnd() + '\n\n' : '') + `## ${s.nome} — ${pl.nome}\n${pl.documento.trim()}\n`; previa();
      }
      await salvar(); desenha();
    };
  }

  const mudar = async st => {
    await salvar();
    try { await q(sb.from('crm_propostas').update({ status: st, ...(st === 'enviada' && { enviada_em: hoje() }) }).eq('id', id)); } catch { return proposta(id); } // o banco recusa passagem errada (a mensagem aparece)
    toast('Proposta ' + rotulo(STATUS_PROP, st).toLowerCase());
    if (st === 'aprovada' && await confirma('Criar o contrato agora?')
      && await novoContrato({ cliente_id: c.id, proposta_id: id, titulo: p.titulo, valor_avulso: p.valor })) return; // contratos.js navega sozinho
    proposta(id);
  };
  $('#st').onchange = e => mudar(e.target.value);
  main.querySelectorAll('[data-st]').forEach(b => b.onclick = () => mudar(b.dataset.st));

  if ($('#copiarLink')) $('#copiarLink').onclick = () => navigator.clipboard.writeText($('#linkProp').value).then(() => toast('Link copiado'), () => { $('#linkProp').select(); toast('Selecione e copie o link'); });
  $('#nv').onclick = async () => {
    await salvar();
    const { id: _, criado_em, crm_clientes, enviada_em, ...base } = p;
    const [n] = await q(sb.from('crm_propostas').insert({ ...base, versao: ult.versao + 1, status: 'rascunho' }).select('id'));
    toast(`v${ult.versao + 1} criada`); location.hash = '#/proposta/' + n.id;
  };
  $('#pdf').onclick = async () => { await salvar(); imprimir(p, c); };
  $('#envDrive').onclick = async () => {
    try {
      if (!c.drive_pasta && !await pastaDoCliente(c)) return;
      if (!await formulario('Enviar PDF ao Drive', [], {}, '<p class="mute">Use o PDF que você salvou em “Gerar PDF”.</p><label>Arquivo PDF<input type="file" id="pdfDrive" accept="application/pdf" required></label>', 'Enviar')) return;
      const arquivo = $('#pdfDrive').files[0]; if (!arquivo) return; // o diálogo continua no DOM depois de fechar
      await enviarAoDrive({ cliente: c, arquivo, tipo: 'PROPOSTA', subpasta: '03', versao: p.versao, vinculo: { proposta_id: p.id }, classificacao: 'cliente' });
      proposta(id);
    } catch (e) { toast(e.message, true); }
  };
  $('#apagar').onclick = async () => {
    if (!await confirma(`Apagar a v${p.versao} desta proposta? As outras versões ficam.`)) return;
    await q(sb.from('crm_propostas').delete().eq('id', id));
    const resto = vers.filter(v => v.id !== id);
    location.hash = resto.length ? '#/proposta/' + resto.at(-1).id : '#/propostas';
  };
}

// WhatsApp do cliente com a mensagem pronta (sem telefone na ficha, o WhatsApp abre para escolher o contato)
const zap = (c, texto) => `https://wa.me/${c.telefone ? c.telefone.replace(/\D/g, '').replace(/^(?!55)/, '55') : ''}?text=${encodeURIComponent(texto)}`;

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
  imprimirDiv(d, nomeArquivo(p, c));
}
async function imprimirDiv(d, nome) {
  document.body.append(d);
  await d.querySelector('img').decode().catch(() => { });
  const titulo = document.title; document.title = nome;
  addEventListener('afterprint', () => { d.remove(); document.title = titulo; }, { once: true });
  print();
}
// documento do plano (aba Documentos do serviço), no mesmo papel da proposta
function imprimirPlano(s, pl) {
  document.getElementById('impressao')?.remove();
  const d = document.createElement('div'); d.id = 'impressao';
  d.innerHTML = `<header><img src="img/rosa.svg" alt=""><span><b>ROVYA</b><small>CREATIVE</small></span></header>
    <div class="cab"><div><div class="rot">${esc(s.nome)}</div><h1>${esc(pl.nome)}</h1></div><div class="meta">${pl.preco != null ? precoPlano(pl) : ''}</div></div>
    ${itensDe(pl).length ? `<div class="corpo">${itensDe(pl).map(x => '• ' + esc(x)).join('\n')}</div>` : ''}
    <div class="corpo">${mdHtml(pl.documento)}</div>
    <footer>ROVYA · Branding e Comunicação</footer>`;
  imprimirDiv(d, `ROVYA_${(s.codigo || s.nome).normalize('NFD').replace(/[^\w-]+/g, '').toUpperCase()}_${pl.nome.normalize('NFD').replace(/[^\w-]+/g, '').toUpperCase()}_${hoje()}`);
}
