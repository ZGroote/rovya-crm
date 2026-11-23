// Assistente da Sabrina: resumo do dia, chat com IA (Gemini, nível pago) e notificações no celular.
// POST com login de admin:
//   {acao:'chat', mensagens:[{role,content}], contexto:{rota,id}}  conversa (sem mensagens = resumo do dia escrito pela IA);
//        devolve {resposta, acoes:[{nome,args}]}: ações que a IA PROPÕE (tarefa, contato, funil, pago, agenda, e-mail, WhatsApp, proposta).
//        Nada é gravado aqui: o CRM mostra cada ação num cartão e só faz quando a Sabrina confirma (com o login dela).
//   {acao:'chave'}                              chave pública para inscrever o celular nas notificações
//   {acao:'testar'}                             manda uma notificação de teste
// POST do pg_cron com header x-cron = crm_config.cron_key: notificação "seu resumo de hoje" + "precisa da sua atenção"
//   (cliente sem retorno, proposta vencendo, contrato acabando, parcela atrasada) + às sextas "sua semana".
// Secrets: GEMINI_API_KEY (chave de um projeto com faturamento = nível pago), GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET.
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as webpush from 'jsr:@negrel/webpush@^0.5.0';

const SUPA = Deno.env.get('SUPABASE_URL')!, SR = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const env = (k: string) => Deno.env.get(k) ?? '';
const db = createClient(SUPA, SR, { auth: { persistSession: false } });
const TZ = 'America/Sao_Paulo';
const APP = 'https://crm.rovyacreative.com.br/app.html';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, apikey, x-client-info, x-cron', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...cors, 'Content-Type': 'application/json' } });
const hojeSP = () => new Date().toLocaleDateString('sv', { timeZone: TZ });
const brl = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

/* ---------- dados ---------- */
async function agenda(dias: number) {
  const { data } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
  if (!data?.refresh_token) return null;
  const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
    body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: data.refresh_token, grant_type: 'refresh_token' }) })).json();
  if (!t.access_token) return null;
  const de = new Date(`${hojeSP()}T00:00:00-03:00`), ate = new Date(de.getTime() + dias * 864e5);
  const r = await (await fetch('https://www.googleapis.com/calendar/v3/calendars/primary/events?' + new URLSearchParams({
    timeMin: de.toISOString(), timeMax: ate.toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '100' }),
    { headers: { Authorization: 'Bearer ' + t.access_token } })).json();
  return (r.items ?? []).map((e: any) => ({
    quando: e.start?.dateTime ? new Date(e.start.dateTime).toLocaleString('pt-BR', { timeZone: TZ, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : `${e.start?.date} (dia todo)`,
    titulo: e.summary || '(sem título)', local: e.location || undefined, dia: (e.start?.dateTime ? new Date(e.start.dateTime).toLocaleDateString('sv', { timeZone: TZ }) : e.start?.date) }));
}

// Só o que está vivo vai para a IA (aberto, em andamento ou do último ano): mandar a história inteira deixaria
// cada pergunta mais cara e mais lenta a cada mês. Para perguntas de anos anteriores, vão os totais por ano.
async function retrato() {
  const desde = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const [cli, ops, projs, parc, ag, contr, tars, hist, props, anos] = await Promise.all([
    db.from('crm_clientes').select('id,codigo,nome,empresa,origem,criado_em').order('nome'),
    db.from('crm_oportunidades').select('id,cliente_id,titulo,etapa,valor,proximo_passo,proximo_em,motivo_perda,atualizado_em,crm_clientes(nome,empresa)')
      .or(`etapa.not.in.(ganho,perdido),atualizado_em.gte.${desde}`),
    db.from('crm_projetos').select('id,nome,status,valor,entrega_prevista,inicio,crm_clientes(nome,empresa),crm_etapas(ordem,titulo,crm_entregas(ordem,titulo,status,prazo))')
      .or(`status.in.(ativo,pausado),criado_em.gte.${desde}`).neq('status', 'arquivado'),
    db.from('crm_parcelas').select('id,tipo,categoria,descricao,valor,vencimento,pago_em,forma,crm_projetos(nome)').or(`pago_em.is.null,vencimento.gte.${desde}`).order('vencimento'),
    agenda(14),
    db.from('crm_contratos').select('titulo,tipo,status,inicio,fim,valor_mensal,valor_avulso,renovacao_auto,aviso_dias,crm_clientes(nome,empresa)')
      .or(`status.in.(rascunho,assinatura,vigente),fim.gte.${desde}`).order('fim'),
    db.from('crm_tarefas').select('titulo,prioridade,prazo,status,concluida_em,lembrete,lembrete_enviado,crm_projetos(nome)').neq('status', 'feita').order('prazo'),
    db.from('crm_interacoes').select('tipo,resumo,data,crm_clientes(nome,empresa)').order('data', { ascending: false }).limit(40),
    db.from('crm_propostas').select('id,grupo,titulo,versao,status,valor,validade,enviada_em,crm_clientes(nome,empresa)')
      .or(`status.in.(rascunho,enviada),criado_em.gte.${desde}`).order('versao', { ascending: false }),
    db.from('crm_parcelas').select('tipo,valor,pago_em').not('pago_em', 'is', null), // só para os totais por ano
  ]);
  const totais: Record<string, { recebido: number, pago: number }> = {};
  for (const x of anos.data ?? []) {
    const a = (totais[x.pago_em.slice(0, 4)] ||= { recebido: 0, pago: 0 });
    if (x.tipo === 'receita') a.recebido += Number(x.valor) || 0; else a.pago += Number(x.valor) || 0;
  }
  const ultimas = new Map<string, any>(); // só a última versão de cada proposta
  for (const p of props.data ?? []) if (!ultimas.has(p.grupo)) ultimas.set(p.grupo, p);
  const quem = (c: any) => c ? (c.empresa ? `${c.empresa} (${c.nome})` : c.nome) : '';
  return {
    hoje: new Date().toLocaleDateString('pt-BR', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }),
    hoje_iso: hojeSP(),
    agora: new Date().toLocaleTimeString('pt-BR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }), // "daqui 2 horas"
    clientes: (cli.data ?? []).map(c => ({ id: c.id, codigo: c.codigo, nome: c.nome, empresa: c.empresa, origem: c.origem, desde: c.criado_em?.slice(0, 10) })),
    funil: (ops.data ?? []).map((o: any) => ({ id: o.id, cliente_id: o.cliente_id, cliente: quem(o.crm_clientes), oportunidade: o.titulo, etapa: o.etapa, valor: o.valor, proximo_passo: o.proximo_passo, proximo_em: o.proximo_em, motivo_perda: o.motivo_perda, atualizado: o.atualizado_em?.slice(0, 10) })),
    projetos: (projs.data ?? []).map((p: any) => ({ id: p.id, nome: p.nome, cliente: quem(p.crm_clientes) || 'Rovya (projeto interno)', status: p.status, valor: p.valor, inicio: p.inicio, entrega_prevista: p.entrega_prevista,
      etapas: (p.crm_etapas ?? []).sort((a: any, b: any) => a.ordem - b.ordem).map((e: any) => ({ etapa: e.titulo,
        entregas: (e.crm_entregas ?? []).sort((a: any, b: any) => a.ordem - b.ordem).map((x: any) => `${x.titulo} [${x.status}${x.prazo ? ', prazo ' + x.prazo : ''}]`) })) })),
    totais_por_ano_pagos: totais, // receitas recebidas e despesas pagas de todos os anos (os lançamentos abaixo são só do último ano + em aberto)
    lancamentos: (parc.data ?? []).map((x: any) => ({ id: x.id, tipo: x.tipo, categoria: x.categoria, projeto: x.crm_projetos?.nome, descricao: x.descricao, valor: x.valor, vencimento: x.vencimento, pago_em: x.pago_em, forma: x.forma })),
    contratos: (contr.data ?? []).map((x: any) => ({ cliente: quem(x.crm_clientes), titulo: x.titulo, tipo: x.tipo, status: x.status, inicio: x.inicio, fim: x.fim,
      valor_mensal: x.valor_mensal, valor_avulso: x.valor_avulso, renovacao_auto: x.renovacao_auto, aviso_dias: x.aviso_dias })),
    tarefas_abertas: (tars.data ?? []).map((t: any) => ({ titulo: t.titulo, prioridade: t.prioridade, prazo: t.prazo, status: t.status, projeto: t.crm_projetos?.nome,
      lembrete: t.lembrete && !t.lembrete_enviado ? new Date(t.lembrete).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : undefined })),
    historico_contatos: (hist.data ?? []).map((h: any) => ({ cliente: quem(h.crm_clientes), tipo: h.tipo, data: h.data, resumo: h.resumo })),
    propostas: [...ultimas.values()].map((p: any) => ({ id: p.id, cliente: quem(p.crm_clientes), titulo: p.titulo, versao: p.versao, status: p.status, valor: p.valor, validade: p.validade, enviada_em: p.enviada_em })),
    agenda_14_dias: ag ?? 'Google Agenda não conectado',
  };
}

// resumo curto, sem IA, para a notificação
function resumoCurto(r: any) {
  const h = r.hoje_iso, partes: string[] = [];
  const ev = Array.isArray(r.agenda_14_dias) ? r.agenda_14_dias.filter((e: any) => e.dia === h).length : 0;
  if (ev) partes.push(`📅 ${ev} compromisso${ev > 1 ? 's' : ''}`);
  const ent = r.projetos.filter((p: any) => p.status === 'ativo').flatMap((p: any) => p.etapas.flatMap((e: any) => e.entregas))
    .filter((t: string) => !t.includes('[aprovado') && (t.match(/prazo (\d{4}-\d{2}-\d{2})/)?.[1] ?? '9999') <= h).length;
  if (ent) partes.push(`✅ ${ent} entrega${ent > 1 ? 's' : ''} no prazo`);
  const tar = r.tarefas_abertas.filter((t: any) => t.prazo && t.prazo <= h).length;
  if (tar) partes.push(`📌 ${tar} tarefa${tar > 1 ? 's' : ''} para hoje`);
  const din = r.lancamentos.filter((x: any) => x.tipo !== 'despesa' && !x.pago_em && x.vencimento && x.vencimento <= h).reduce((s: number, x: any) => s + +x.valor, 0);
  if (din) partes.push(`💰 ${brl(din)} a receber`);
  const pend = r.funil.filter((o: any) => !['ganho', 'perdido'].includes(o.etapa) && o.proximo_em && o.proximo_em <= h).length;
  if (pend) partes.push(`⚠️ ${pend} próximo${pend > 1 ? 's' : ''} passo${pend > 1 ? 's' : ''}`);
  return partes.length ? partes.join(' • ') : 'Dia tranquilo por aqui ✨ Toque para ver seu resumo.';
}

/* ---------- IA ---------- */
const SISTEMA = `Você é a assistente pessoal da Sabrina, dona da Rovya Creative (consultoria de posicionamento e gestão estratégica da comunicação).
Você conversa com ela dentro do CRM da Rovya, como num chat de celular: português do Brasil, tom próximo e elegante, respostas curtas e diretas, com poucos emojis e listas curtas quando ajudar.
Responda só com base nos DADOS DO CRM abaixo. Se algo não estiver nos dados, diga que não encontrou no CRM em vez de inventar. Valores em reais (R$), datas no formato brasileiro.
AÇÕES: quando ela pedir para FAZER algo, use as ferramentas (pode usar mais de uma): criar tarefa, anotar contato no histórico, mover no funil, marcar lançamento como pago, agendar compromisso (com Meet e convite), abrir horário no site (período livre para novos clientes marcarem em rovyacreative.com.br/agendar; NUNCA use agendar compromisso para isso: compromisso OCUPA o horário e o site esconde), escrever e-mail, escrever WhatsApp, rascunho de proposta. Você só PROPÕE: o CRM mostra um cartão e nada acontece até ela confirmar, então proponha sem pedir licença antes e diga em uma frase o que preparou. Use sempre os ids que estão nos DADOS (nunca invente id; se não achar o cliente ou o registro, pergunte). Datas YYYY-MM-DD; horas HH:MM no horário de Brasília; "amanhã", "sexta" etc. contam a partir de hoje_iso, e "daqui 2 horas" a partir de agora. "Me lembra de…" / "me avisa…" = criar tarefa com lembrete (se ela não disser a hora, use 09:00 do dia; se não disser o dia, pergunte). Para mudar algo que as ferramentas não cobrem, explique onde fazer no CRM.
Textos de e-mail, WhatsApp e proposta: escreva completos, prontos para enviar, na voz da Sabrina (primeira pessoa, próxima, elegante, sem exagero nem clichê de marketing), usando o que os DADOS dizem do cliente. Ideias de pauta, legendas e roteiros: responda em texto, sem ferramenta.
TELA ABERTA: quando vier, é o que ela está vendo no CRM agora; "aqui", "ela", "esse cliente" se referem a isso.
Se ela perguntar o que você sabe fazer: responder sobre o CRM, fazer as ações acima com confirmação, escrever textos e avisar no celular (resumo às 7h30, o que precisa de atenção e, às sextas, como foi a semana).
Status das entregas: a_fazer, produzindo, enviado, revisao, aprovado. Etapas do funil: contato, diagnostico, proposta, negociacao, ganho, perdido.
Contratos: tipo recorrente (valor_mensal), avulso (valor_avulso) ou misto (os dois); status rascunho, assinatura, vigente, encerrado, cancelado; avise quando um vigente estiver a aviso_dias ou menos do fim. Propostas: status rascunho, enviada, aprovada, recusada (só a última versão de cada uma). Lançamentos: tipo receita ou despesa; pago_em vazio = em aberto. Tarefas: prioridade baixa/media/alta. historico_contatos: últimos contatos registrados com cada cliente (use para lembrar quem está sem retorno).
Os dados trazem o que está em aberto ou em andamento e o que aconteceu no último ano (funil, projetos, lançamentos, contratos, propostas); de anos anteriores vêm só totais_por_ano_pagos. Se ela perguntar um detalhe mais antigo que isso, diga que o resumo só traz o último ano e indique a tela do CRM onde está (Financeiro, Projetos, Contratos…).
Quando ela pedir o resumo do dia, organize em: agenda de hoje, entregas e tarefas com prazo hoje ou atrasadas, dinheiro a receber e contas a pagar hoje ou atrasados, próximos passos do funil vencendo, contratos a vencer ou aguardando assinatura, propostas enviadas ainda sem resposta, e termine com uma sugestão prática de prioridade. Se o dia estiver vazio, diga isso com leveza.`;

const MODELO = 'gemini-3.8-flash';

// ferramentas: a IA só propõe; o CRM mostra o cartão e faz com o login dela depois do "confirmar"
const S = (description: string, x: Record<string, unknown> = {}) => ({ type: 'string', description, ...x });
const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object',
  properties: { rotulo: S('frase curta para o cartão de confirmar, ex.: "Tarefa: ligar para a Marina (sex, 20/11)"'), ...properties }, required: ['rotulo', ...required] });
const FERRAMENTAS = [
  { name: 'criar_tarefa', description: 'Propõe uma tarefa nova; com lembrete, chega uma notificação no celular e no computador dela no dia e hora.', parameters: obj({ titulo: S('título da tarefa'), descricao: S('detalhes (opcional)'), prazo: S('YYYY-MM-DD'),
    lembrete: S('quando avisar: YYYY-MM-DDTHH:MM no horário de Brasília (opcional; use quando ela pedir para lembrar ou avisar)'),
    prioridade: S('prioridade', { enum: ['baixa', 'media', 'alta'] }), cliente_id: S('id do cliente'), projeto_id: S('id do projeto') }, ['titulo']) },
  { name: 'registrar_contato', description: 'Anota no histórico do cliente (reunião, ligação, mensagem, e-mail, visita ou anotação); com oportunidade, atualiza o próximo passo do funil.',
    parameters: obj({ cliente_id: S('id do cliente'), oportunidade_id: S('id da oportunidade aberta dele (opcional)'), tipo: S('tipo', { enum: ['reuniao', 'ligacao', 'mensagem', 'email', 'visita', 'nota'] }),
      data: S('YYYY-MM-DD'), texto: S('o que foi conversado'), proximo_passo: S('próximo passo (opcional)'), proximo_em: S('YYYY-MM-DD (opcional)') }, ['cliente_id', 'texto']) },
  { name: 'mover_oportunidade', description: 'Muda a etapa de uma oportunidade no funil (ganho cria o projeto).',
    parameters: obj({ oportunidade_id: S('id da oportunidade'), etapa: S('etapa nova', { enum: ['contato', 'diagnostico', 'proposta', 'negociacao', 'ganho', 'perdido'] }), motivo_perda: S('se perdido') }, ['oportunidade_id', 'etapa']) },
  { name: 'marcar_pago', description: 'Marca um lançamento (receita ou despesa) como pago hoje.', parameters: obj({ lancamento_id: S('id do lançamento') }, ['lancamento_id']) },
  { name: 'agendar_compromisso', description: 'Cria um compromisso no Google Agenda dela, com link do Meet e convite ao cliente quando fizer sentido.',
    parameters: obj({ titulo: S('título'), data: S('YYYY-MM-DD'), hora: S('HH:MM, Brasília'), duracao: { type: 'integer', description: 'minutos' }, cliente_id: S('id do cliente (opcional)'),
      meet: { type: 'boolean', description: 'criar link do Meet' }, convidar: { type: 'boolean', description: 'mandar convite ao e-mail do cliente' }, notas: S('notas (opcional)') }, ['titulo', 'data', 'hora']) },
  { name: 'abrir_horario_site', description: 'Abre um período na agenda para novos clientes marcarem a primeira conversa pelo site (conversas de 60 min dentro do período). Horas cheias, das 6 às 22.',
    parameters: obj({ data: S('YYYY-MM-DD'), hora_inicio: { type: 'integer', description: 'hora cheia de início (ex.: 14)' }, hora_fim: { type: 'integer', description: 'hora cheia de fim (ex.: 18)' },
      repetir: { type: 'boolean', description: 'repetir toda semana' } }, ['data', 'hora_inicio', 'hora_fim']) },
  { name: 'escrever_email', description: 'Escreve um e-mail para um cliente; ela revisa e envia pelo Gmail.', parameters: obj({ cliente_id: S('id do cliente'), assunto: S('assunto'), texto: S('texto completo') }, ['cliente_id', 'assunto', 'texto']) },
  { name: 'escrever_whatsapp', description: 'Escreve uma mensagem de WhatsApp para um cliente; ela abre no WhatsApp e envia.', parameters: obj({ cliente_id: S('id do cliente'), texto: S('mensagem completa') }, ['cliente_id', 'texto']) },
  { name: 'rascunho_proposta', description: 'Cria o rascunho de uma proposta comercial para o cliente (texto em Markdown, seções com ##).',
    parameters: obj({ cliente_id: S('id do cliente'), oportunidade_id: S('id da oportunidade (opcional)'), titulo: S('título'), corpo: S('texto da proposta em Markdown') }, ['cliente_id', 'titulo', 'corpo']) },
];
const NOMES = new Set(FERRAMENTAS.map(f => f.name));

// a tela que ela está olhando no CRM (vem junto da pergunta): ficha do cliente, projeto, proposta ou contrato
const TELAS: Record<string, [string, string]> = {
  cliente: ['crm_clientes', 'id,codigo,nome,empresa,email,telefone,instagram,origem,notas,criado_em'],
  projeto: ['crm_projetos', 'id,nome,status,valor,inicio,entrega_prevista,cliente_id,crm_clientes(nome,empresa)'],
  proposta: ['crm_propostas', 'id,titulo,versao,status,valor,validade,enviada_em,cliente_id,crm_clientes(nome,empresa)'],
  contrato: ['crm_contratos', 'id,titulo,tipo,status,inicio,fim,valor_mensal,valor_avulso,cliente_id,crm_clientes(nome,empresa)'],
};
async function telaAberta(c: any) {
  const rota = String(c?.rota ?? '').replace(/[^a-z]/g, '').slice(0, 30), id = /^[\w-]{1,64}$/.test(String(c?.id ?? '')) ? String(c.id) : '';
  if (!rota) return null;
  if (!TELAS[rota] || !id) return { tela: rota };
  const { data } = await db.from(TELAS[rota][0]).select(TELAS[rota][1]).eq('id', id).maybeSingle();
  if (!data) return { tela: rota };
  const cid = rota === 'cliente' ? id : (data as any).cliente_id;
  const hist = cid ? (await db.from('crm_interacoes').select('tipo,data,resumo').eq('cliente_id', cid).order('data', { ascending: false }).limit(30)).data : [];
  return { tela: rota, registro: data, historico_deste_cliente: hist ?? [] };
}

async function conversar(mensagens: { role: 'user' | 'assistant'; content: string }[], contexto?: unknown) {
  const [dados, tela] = await Promise.all([retrato(), telaAberta(contexto)]);
  const msgs = mensagens.length ? mensagens : [{ role: 'user' as const, content: 'Bom dia! Me dá o resumo de hoje?' }];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: `${SISTEMA}\n\nDADOS DO CRM (atualizados agora):\n${JSON.stringify(dados)}${tela ? `\n\nTELA ABERTA:\n${JSON.stringify(tela)}` : ''}` }] },
      tools: [{ functionDeclarations: FERRAMENTAS }],
      contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });
  const j = await r.json();
  if (!r.ok) { console.error('gemini', r.status, j.error?.message); throw new Error(`IA indisponível (${r.status}). Tente de novo em instantes.`); }
  if (j.promptFeedback?.blockReason) return { resposta: 'Desculpe, não consegui responder isso. Pode perguntar de outro jeito?', acoes: [] };
  const partes = j.candidates?.[0]?.content?.parts ?? [];
  const texto = partes.filter((p: any) => !p.thought).map((p: any) => p.text ?? '').join('').trim();
  const acoes = partes.filter((p: any) => NOMES.has(p.functionCall?.name)).slice(0, 6).map((p: any) => ({ nome: p.functionCall.name, args: p.functionCall.args ?? {} }));
  return { resposta: texto || (acoes.length ? 'Preparei para você conferir:' : 'Não consegui montar uma resposta agora.'), acoes };
}

/* ---------- avisos no celular (sem IA): o que está parado ou vencendo, e às sextas a semana ---------- */
const SEM_RETORNO_DIAS = 10;
const diaMais = (h: string, d: number) => new Date(Date.parse(h + 'T12:00:00Z') + d * 864e5).toISOString().slice(0, 10);
async function alertas(r: any) {
  const h = r.hoje_iso, itens: string[] = [];
  const abertas = r.funil.filter((o: any) => !['ganho', 'perdido'].includes(o.etapa) && o.cliente_id);
  if (abertas.length) {
    const { data } = await db.from('crm_interacoes').select('cliente_id,data').in('cliente_id', [...new Set(abertas.map((o: any) => o.cliente_id))]).order('data', { ascending: false });
    const ult = new Map<string, string>(); for (const x of data ?? []) if (!ult.has(x.cliente_id)) ult.set(x.cliente_id, x.data);
    const parados = [...new Set(abertas.filter((o: any) => (ult.get(o.cliente_id) ?? o.atualizado ?? '') < diaMais(h, -SEM_RETORNO_DIAS)).map((o: any) => o.cliente))];
    if (parados.length) itens.push(`💬 sem retorno há ${SEM_RETORNO_DIAS}+ dias: ${parados.join(', ')}`);
  }
  for (const p of r.propostas) if (p.status === 'enviada' && p.validade && p.validade >= h && p.validade <= diaMais(h, 3))
    itens.push(`📄 proposta de ${p.cliente} vence ${p.validade === h ? 'hoje' : `em ${Math.round((Date.parse(p.validade) - Date.parse(h)) / 864e5)} dia(s)`}`);
  for (const c of r.contratos) if (c.status === 'vigente' && c.fim && c.fim >= h && c.fim <= diaMais(h, c.aviso_dias ?? 30))
    itens.push(`⚖️ contrato de ${c.cliente} termina em ${c.fim.split('-').reverse().join('/')}`);
  const atras = r.lancamentos.filter((x: any) => x.tipo !== 'despesa' && !x.pago_em && x.vencimento && x.vencimento < h);
  if (atras.length) itens.push(`💰 ${atras.length} parcela(s) atrasada(s): ${brl(atras.reduce((s: number, x: any) => s + +x.valor, 0))}`);
  return itens;
}
async function semana(r: any) {
  const de = diaMais(r.hoje_iso, -6);
  const [{ count: feitas }, { count: contatos }] = await Promise.all([
    db.from('crm_tarefas').select('id', { count: 'exact', head: true }).eq('status', 'feita').gte('concluida_em', de),
    db.from('crm_interacoes').select('id', { count: 'exact', head: true }).gte('data', de)]);
  const recebido = r.lancamentos.filter((x: any) => x.tipo !== 'despesa' && x.pago_em && x.pago_em >= de).reduce((s: number, x: any) => s + +x.valor, 0);
  const novos = r.clientes.filter((c: any) => c.desde && c.desde >= de).length;
  return `✅ ${feitas ?? 0} tarefa(s) feita(s) • 💰 ${brl(recebido)} recebido • 💬 ${contatos ?? 0} contato(s) • ✨ ${novos} cliente(s) novo(s)`;
}
// cabe na notificação: junta até ~190 caracteres e diz quantos ficaram de fora
const caber = (itens: string[], max = 190) => {
  let t = '';
  for (const [i, x] of itens.entries()) { const n = t ? `${t} • ${x}` : x; if (n.length > max) return t ? `${t} (+${itens.length - i})` : x.slice(0, max - 1) + '…'; t = n; }
  return t;
};

/* ---------- notificações ---------- */
async function servidorPush() {
  const { data } = await db.from('crm_config').select('valor').eq('chave', 'vapid').maybeSingle();
  let chaves;
  if (data?.valor) chaves = await webpush.importVapidKeys(JSON.parse(data.valor), { extractable: false });
  else { // primeira vez: gera e guarda no banco (a privada nunca sai do servidor)
    const novas = await webpush.generateVapidKeys({ extractable: true });
    await db.from('crm_config').insert({ chave: 'vapid', valor: JSON.stringify(await webpush.exportVapidKeys(novas)) });
    chaves = novas;
  }
  const app = await webpush.ApplicationServer.new({ contactInformation: 'mailto:rovyacreative@gmail.com', vapidKeys: chaves });
  return { app, publica: await webpush.exportApplicationServerKey(chaves) };
}

async function notificar(titulo: string, corpo: string, url = '#/assistente') {
  const { app } = await servidorPush();
  const { data: subs } = await db.from('crm_push').select('endpoint,inscricao');
  let ok = 0, removidas = 0;
  for (const s of subs ?? []) {
    try {
      await app.subscribe(s.inscricao).pushTextMessage(JSON.stringify({ title: titulo, body: corpo, url: APP + url }), {});
      ok++;
    } catch (e) {
      const st = (e as any)?.response?.status;
      if (st === 404 || st === 410 || (e as any)?.isGone?.()) { await db.from('crm_push').delete().eq('endpoint', s.endpoint); removidas++; }
      else console.error('push falhou', st, (e as Error).message);
    }
  }
  return { enviadas: ok, removidas, total: subs?.length ?? 0 };
}

/* ---------- lembretes das tarefas (pg_cron crm-lembretes, 019_lembretes.sql: só chama quando há um vencido) ----------
   Marca cada tarefa como enviada antes de notificar, com a condição "ainda não enviada": se duas chamadas se cruzarem, só uma envia. */
async function lembretes() {
  const agora = new Date().toISOString();
  const { data } = await db.from('crm_tarefas').select('id,titulo,descricao,prazo,crm_clientes(nome,empresa)')
    .lte('lembrete', agora).is('lembrete_enviado', null).neq('status', 'feita').limit(20);
  let enviados = 0;
  for (const t of data ?? []) {
    const { data: meu } = await db.from('crm_tarefas').update({ lembrete_enviado: agora }).eq('id', t.id).is('lembrete_enviado', null).select('id');
    if (!meu?.length) continue;
    const c = t.crm_clientes, prazo = t.prazo ? 'prazo ' + t.prazo.split('-').reverse().slice(0, 2).join('/') : '';
    await notificar('⏰ ' + String(t.titulo).slice(0, 70), caber([c ? c.empresa || c.nome : '', prazo, String(t.descricao || '').slice(0, 100)].filter(Boolean)), '#/tarefas');
    enviados++;
  }
  return { lembretes: enviados };
}

/* ---------- verificação a cada 6 h (pg_cron crm-verificacao, 016_verificacao.sql) ----------
   Testa o Google (renova o acesso e lê a lista de agendas) e o Gemini (uma pergunta mínima, que também mostra se os créditos acabaram).
   Funcionando: as falhas daquela origem saem da tela (resolvida = true; a linha continua no banco e o crm_log guarda a mudança).
   Quebrado: vira um aviso só, sem repetir a cada 6 h. Erros de código (origem 'tela', para quem mantém o CRM) saem depois de 3 dias.
   'agenda' (conflitos de compromissos) e 'backup' não entram: a primeira pede ação dela, a segunda sai quando um backup der certo. */
const GRUPOS: Record<string, string[]> = { google: ['crm-google', 'drive'], ia: ['crm-assistente'] };
async function verificacao() {
  const res: Record<string, string | true> = {};
  const { data: g } = await db.from('crm_google').select('refresh_token').eq('id', 1).maybeSingle();
  if (!g?.refresh_token) res.google = 'O Google da Rovya não está conectado: Agenda, Drive, Gmail e backup param. Em Agenda → Conectar Google Agenda.';
  else {
    const t = await (await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      body: new URLSearchParams({ client_id: env('GOOGLE_CLIENT_ID'), client_secret: env('GOOGLE_CLIENT_SECRET'), refresh_token: g.refresh_token, grant_type: 'refresh_token' }) })).json().catch(() => ({}));
    if (!t.access_token) res.google = 'O Google parou de aceitar a conexão do CRM. Em Agenda → Reconectar Google.';
    else {
      const c = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?maxResults=1', { headers: { Authorization: 'Bearer ' + t.access_token } });
      res.google = c.ok || `O Google Agenda respondeu com erro (${c.status}) na verificação automática.`;
    }
  }
  if (!env('GEMINI_API_KEY')) res.ia = 'O Assistente está sem a chave do Gemini (GEMINI_API_KEY nos secrets do Supabase).';
  else {
    const m = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO}:generateContent`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env('GEMINI_API_KEY') },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'ok' }] }], generationConfig: { maxOutputTokens: 16 } }) });
    const erro = m.ok ? '' : String((await m.json().catch(() => ({})))?.error?.message ?? '');
    res.ia = m.ok || (m.status === 402 || /credit/i.test(erro) ? 'Os créditos do Gemini acabaram: o Assistente parou. No AI Studio → Projetos → CRM SA → Comprar créditos.'
      : `O Gemini recusou a verificação automática (${m.status}).`);
  }
  for (const [k, origens] of Object.entries(GRUPOS)) {
    if (res[k] === true) { await db.from('crm_falhas').update({ resolvida: true }).eq('resolvida', false).in('origem', origens); continue; }
    const { data: ja } = await db.from('crm_falhas').select('id').eq('resolvida', false).eq('origem', origens[0]).eq('mensagem', res[k]).limit(1);
    if (!ja?.length) await db.from('crm_falhas').insert({ origem: origens[0], acao: 'verificação automática', mensagem: res[k] });
  }
  await db.from('crm_falhas').update({ resolvida: true }).eq('resolvida', false).eq('origem', 'tela').lt('quando', new Date(Date.now() - 3 * 864e5).toISOString());
  return res;
}

async function eAdmin(req: Request) {
  const t = req.headers.get('Authorization')?.replace(/^Bearer /, '');
  if (!t) return false;
  const { data: { user } } = await db.auth.getUser(t);
  if (!user?.email) return false;
  // MFA: quem tem fator verificado precisa de sessão aal2 (o token já foi validado pelo getUser)
  const aal = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).aal;
  if (user.factors?.some((f: any) => f.status === 'verified') && aal !== 'aal2') return false;
  return !!(await db.from('admins').select('email').eq('email', user.email).maybeSingle()).data;
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const cron = req.headers.get('x-cron');
    if (cron) {
      const { data } = await db.from('crm_config').select('valor').eq('chave', 'cron_key').maybeSingle();
      if (!data?.valor || cron !== data.valor) return json({ erro: 'Sem permissão' }, 401);
      // aviso avulso de outra função (ex.: crm-agendar quando alguém marca pelo site); sem aviso, é o resumo das 7h30
      const { aviso, verificar, lembretes: lemb } = await req.json().catch(() => ({}));
      if (verificar) return json(await verificacao());
      if (lemb) return json(await lembretes());
      if (aviso?.titulo) return json(await notificar(String(aviso.titulo).slice(0, 80), String(aviso.corpo || '').slice(0, 200), String(aviso.url || '').startsWith('app.html#/') ? String(aviso.url).slice(8) : '#/agenda'));
      const r = await retrato(), enviados = [await notificar('Bom dia, Sabrina! ☀️', resumoCurto(r))];
      const al = await alertas(r);
      if (al.length) enviados.push(await notificar('Precisa da sua atenção', caber(al)));
      if (new Date().toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short' }) === 'Fri') enviados.push(await notificar('Sua semana ✦', await semana(r)));
      return json(enviados);
    }
    if (!await eAdmin(req)) return json({ erro: 'Sem permissão' }, 401);
    const b = await req.json().catch(() => ({}));
    switch (b.acao) {
      case 'chave': return json({ publica: (await servidorPush()).publica });
      case 'testar': return json(await notificar('Rovya ✦', 'As notificações estão funcionando neste aparelho.'));
      case 'chat': {
        if (!env('GEMINI_API_KEY')) return json({ erro: 'Assistente ainda não configurado (falta GEMINI_API_KEY nos secrets).' }, 503);
        const msgs = (Array.isArray(b.mensagens) ? b.mensagens : []).slice(-20)
          .filter((m: any) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .map((m: any) => ({ role: m.role, content: m.content.slice(0, 4000) }));
        if (msgs.length && msgs[0].role !== 'user') msgs.shift(); // a conversa precisa começar pela Sabrina
        return json(await conversar(msgs, b.contexto));
      }
    }
    return json({ erro: 'Ação desconhecida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ erro: (e as Error).message }, 500);
  }
});
