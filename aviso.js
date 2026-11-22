// A1: avisar o cliente quando há peça para aprovar. WhatsApp assistido: nada é enviado sozinho.
// mudarStatus é o ÚNICO caminho do CRM para mudar o status de peças: ficha do projeto, ficha da peça, arrastar e mover em lote.
// Ela grava primeiro (numa gravação só, com os outros campos do formulário quando houver); o aviso vem depois e nunca
// impede a gravação: fechar a janela ou o WhatsApp não abrir deixa a peça em Enviado do mesmo jeito.
// O registro no histórico só acontece com confirmação: "Mandou?" no WhatsApp; no e-mail, quando o Gmail confirma o envio.
// O banco (026_aviso_aprovacao.sql) confere a rodada da peça e o código do aviso, para não registrar aviso velho nem duplicado.
import { sb, $, esc, toast, q, formulario, funcao, semRede } from './util.js';
import { LINK_PORTAL } from './portal.js';

const LIMITE_TITULOS = 5; // acima disso a mensagem leva só as quantidades e o link
const primeiroNome = c => (c?.nome || '').trim().split(/\s+/)[0] || '';
const numeroZap = tel => (tel || '').replace(/\D/g, '').replace(/^(?!55)/, '55');
const conteudos = (n, novo) => n === 1 ? `1 conteúdo${novo ? ' novo' : ''}` : `${n} conteúdos${novo ? ' novos' : ''}`;

// extras: os campos do formulário da peça (texto, link, prazo…), gravados junto com o status.
// avisar=false: quem chama prepara o aviso depois (o formulário termina de subir os anexos antes de avisar o cliente).
export async function mudarStatus(ids, status, extras = null, { avisar = true, aviso = '' } = {}) {
  ids = [...new Set(ids)];
  const antes = await q(sb.from('crm_entregas').select('id,status').in('id', ids));
  const anterior = Object.fromEntries(antes.filter(x => ids.includes(x.id)).map(x => [x.id, x.status]));
  const dados = { ...(extras || {}), status, atualizado_em: new Date().toISOString() };
  await q(ids.length === 1 ? sb.from('crm_entregas').update(dados).eq('id', ids[0]) : sb.from('crm_entregas').update(dados).in('id', ids));
  if (aviso) toast(aviso);
  const viraram = status === 'enviado' ? ids.filter(i => anterior[i] && anterior[i] !== 'enviado') : [];
  if (avisar && viraram.length) await prepararAviso(viraram, anterior);
  return { viraram, anterior };
}

// mensagem aprovada (22/11/2026): conteúdos novos e/ou ajustados do mesmo cliente numa mensagem só, até 5 títulos no total
export function mensagemAviso(nome, novos, ajustados) {
  const lista = novos.length + ajustados.length <= LIMITE_TITULOS, itens = xs => xs.map(x => '• ' + x.titulo).join('\n');
  const partes = [`Oi${nome ? ', ' + nome : ''}! 😊`];
  if (novos.length) partes.push(`Temos ${conteudos(novos.length, true)} esperando sua aprovação.` + (lista ? '\n\n' + itens(novos) : ''));
  if (ajustados.length) partes.push(ajustados.length === 1 && lista ? `Fizemos os ajustes que você pediu em "${ajustados[0].titulo}".`
    : `Fizemos os ajustes que você pediu em ${conteudos(ajustados.length)}.` + (lista ? '\n\n' + itens(ajustados) : ''));
  if (novos.length) partes.push(`Você pode conferir tudo pelo portal da Rovya:\n${LINK_PORTAL}`, 'Quando puder, dê uma olhadinha para seguirmos com a programação!');
  else partes.push(`A versão atualizada já está no portal para sua aprovação:\n${LINK_PORTAL}`);
  return partes.join('\n\n');
}

// anterior: status de cada peça antes da mudança ('revisao' = reenvio depois de ajuste). Sem anterior (lembrete): conteúdo novo.
export async function prepararAviso(ids, anterior = {}) {
  const linhas = (await q(sb.from('crm_entregas').select('id,titulo,ordem,status,enviado_em,crm_etapas!inner(consulta,crm_projetos!inner(cliente_id,crm_clientes(id,nome,empresa,telefone,email)))').in('id', ids)))
    .filter(x => ids.includes(x.id) && x.status === 'enviado' && !x.crm_etapas.consulta && x.crm_etapas.crm_projetos.crm_clientes); // "só consulta" e projeto da Rovya: sem aviso
  if (!linhas.length) return;
  const grupos = {};
  for (const x of linhas) {
    const c = x.crm_etapas.crm_projetos.crm_clientes, g = grupos[c.id] ||= { c, novos: [], ajustados: [] };
    if (!g.novos.concat(g.ajustados).some(y => y.id === x.id)) g[anterior[x.id] === 'revisao' ? 'ajustados' : 'novos'].push(x);
  }
  const lista = Object.values(grupos);
  const comAcesso = await sb.from('crm_portal').select('cliente_id').in('cliente_id', lista.map(g => g.c.id)).then(r => new Set((r.data || []).map(a => a.cliente_id)), () => new Set());
  const avisos = lista.map(g => ({ ...g, op: crypto.randomUUID(), acesso: comAcesso.has(g.c.id), texto: mensagemAviso(primeiroNome(g.c), g.novos, g.ajustados),
    itens: [...g.novos, ...g.ajustados].map(x => ({ id: x.id, rodada: x.enviado_em })) }));
  const secao = (a, i) => {
    const n = a.itens.length, nome = esc(a.c.empresa || a.c.nome);
    const corpo = !a.acesso
      ? `<p class="mute" style="margin:0">Este cliente ainda não tem acesso ao portal. Dê o acesso primeiro: o link do portal sem acesso não serve para ele.</p>
         <div class="acoes"><a class="bt peq" data-acesso href="#/cliente/${esc(a.c.id)}">Dar acesso ao portal</a></div>`
      : `<textarea data-texto rows="9" style="width:100%">${esc(a.texto)}</textarea>
         <div class="acoes">${a.c.telefone ? `<a class="bt peq" data-zap target="_blank" rel="noopener" href="#">Abrir WhatsApp</a>`
           : a.c.email ? `<button type="button" class="bt peq" data-email>Enviar por e-mail para ${esc(a.c.email)}</button>`
           : '<span class="mute">Sem telefone nem e-mail na ficha. Cadastre um dos dois para avisar.</span>'}</div>
         <div class="acoes" data-mandou hidden><span>Mandou?</span><button type="button" class="bt peq" data-sim>Sim, mandei</button><button type="button" class="bt peq fantasma" data-nao>Ainda não</button></div>`;
    return `<section class="card aviso" data-i="${i}" data-cliente="${esc(a.c.id)}" data-op="${a.op}" style="display:grid;gap:8px;margin:0">
      <b>${nome} <small class="mute">· ${n === 1 ? '1 peça' : n + ' peças'} para aprovar</small></b>${corpo}<small class="mute" data-estado></small></section>`;
  };
  const pronto = formulario('Avisar o cliente', [], {}, `<p class="mute" style="margin:0">A peça já está salva como Enviado. Avise agora ou feche e avise depois (o lembrete continua no Início).</p>
    <div style="display:grid;gap:12px">${avisos.map(secao).join('')}</div>`, 'Fechar');
  for (const [i, a] of avisos.entries()) {
    const el = $(`#dlgf .aviso[data-i="${i}"]`), estado = t => el.querySelector('[data-estado]').textContent = t;
    const texto = () => el.querySelector('[data-texto]')?.value || a.texto;
    const registrar = async canal => {
      try {
        const r = await q(sb.rpc('crm_aviso_confirmar', { p_operacao: a.op, p_cliente: a.c.id, p_canal: canal, p_itens: a.itens }));
        estado(r?.ja ? 'Já estava registrado no histórico.' : `Registrado no histórico ✓${r?.ignoradas ? ` (${r.ignoradas} peça(s) mudaram e ficaram de fora)` : ''}`);
        el.querySelectorAll('button,[data-zap]').forEach(b => b.setAttribute('disabled', ''));
      } catch { estado('Não registrado. Prepare o aviso de novo.'); } // a mensagem do banco já apareceu
    };
    el.querySelector('[data-acesso]')?.addEventListener('click', () => $('#dlg').close());
    const zap = el.querySelector('[data-zap]');
    if (zap) zap.onclick = () => { zap.href = `https://wa.me/${numeroZap(a.c.telefone)}?text=${encodeURIComponent(texto())}`; el.querySelector('[data-mandou]').hidden = false; };
    if (el.querySelector('[data-sim]')) el.querySelector('[data-sim]').onclick = () => registrar('whatsapp');
    if (el.querySelector('[data-nao]')) el.querySelector('[data-nao]').onclick = () => { estado('Não registrado. O lembrete continua no Início.'); el.querySelector('[data-mandou]').hidden = true; };
    const email = el.querySelector('[data-email]');
    if (email) email.onclick = async () => {
      email.disabled = true; estado('Enviando…');
      try {
        const r = await funcao('crm-google', 'email', { para: a.c.email, assunto: 'Conteúdos para sua aprovação · Rovya', texto: texto() });
        if (r?.conectado === false) { estado('Gmail não conectado: o e-mail não saiu. Conecte o Google em Agenda.'); email.disabled = false; return; }
        await registrar('email'); // o Gmail confirmou: registra sem perguntar
      } catch (e) { estado('O e-mail não saiu: ' + (semRede(e) ? 'sem internet.' : e.message)); email.disabled = false; }
    };
  }
  await pronto;
}
