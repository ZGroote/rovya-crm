// Configurações: verificação em duas etapas (MFA), backup em formato aberto e registro de alterações.
import { sb, $, main, esc, hoje, toast, q, formulario, confirma } from './util.js';
import { garantirEstrutura, subir } from './drive.js';

// tabelas do backup (as de token/notificação ficam de fora: são segredo ou se refazem sozinhas)
const TABELAS = ['crm_clientes', 'crm_oportunidades', 'crm_interacoes', 'crm_servicos', 'crm_propostas', 'crm_contratos', 'crm_projetos', 'crm_etapas',
  'crm_entregas', 'crm_anexos', 'crm_tarefas', 'crm_parcelas', 'crm_modelos', 'crm_documentos', 'crm_drive'];
const NOMES = { crm_clientes: 'Clientes', crm_oportunidades: 'Funil', crm_interacoes: 'Histórico', crm_servicos: 'Serviços', crm_propostas: 'Propostas',
  crm_contratos: 'Contratos', crm_projetos: 'Projetos', crm_etapas: 'Etapas', crm_entregas: 'Entregas', crm_anexos: 'Anexos', crm_tarefas: 'Tarefas',
  crm_parcelas: 'Financeiro', crm_modelos: 'Modelos', crm_documentos: 'Documentos', crm_drive: 'Drive' };
const ACOES = { INSERT: ['criou', 'p-aprovado'], UPDATE: ['alterou', 'p-produzindo'], DELETE: ['apagou', 'p-revisao'] };

export async function configuracoes(filtroLog = '') {
  const [{ data: fat }, falhas, logs] = await Promise.all([
    sb.auth.mfa.listFactors(),
    q(sb.from('crm_falhas').select('*').eq('resolvida', false).order('quando', { ascending: false }).limit(30)),
    q((filtroLog ? sb.from('crm_log').select('*').eq('tabela', filtroLog) : sb.from('crm_log').select('*')).order('quando', { ascending: false }).limit(120))]);
  const totp = (fat?.totp || []).find(f => f.status === 'verified');
  main.innerHTML = `<div class="topo"><div><div class="eyebrow">Sistema</div><h1>Configurações</h1><p>Segurança, cópias de segurança e o registro de tudo o que muda no CRM.</p></div></div>
    <div class="grade2">
      <section class="card"><h3>Verificação em duas etapas</h3>
        ${totp ? `<p><span class="pill p-aprovado">Ativa</span> Ao entrar, o CRM pede o código de 6 dígitos do app autenticador.</p>
          <button class="bt peq fantasma" id="mfaDesl" style="color:var(--bad)">Desativar</button>`
        : `<p class="mute">Além da senha, o login passa a pedir um código do celular (Google Authenticator, Microsoft Authenticator, 1Password…). Mesmo que alguém descubra a senha, não entra.</p>
          <button class="bt" id="mfaAtivar">Ativar</button>`}</section>
      <section class="card"><h3>Cópia de segurança</h3>
        <p class="mute">Todos os dados do CRM em um arquivo JSON (formato aberto). Os arquivos em si já ficam no Drive e no Storage.</p>
        <div class="acoes"><button class="bt sec" id="bkBaixar">Baixar backup</button><button class="bt" id="bkDrive">Salvar no Drive (15 Tecnologia)</button></div></section>
    </div>
    <section class="card" style="margin-top:18px"><h3>Falhas de integração ${falhas.length ? `<span class="pill p-revisao">${falhas.length}</span>` : ''}</h3>
      <p class="mute">Quando o Drive, o Google Agenda ou o Assistente falham, fica anotado aqui. Nada é refeito sozinho: confira e tente de novo pela própria tela.</p>
      <ul class="lista">${falhas.map(f => `<li><div class="cresce"><b>${esc(f.mensagem)}</b><small>${esc(f.origem)}${f.acao ? ' · ' + esc(f.acao) : ''} · ${new Date(f.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></div><button class="bt peq sec" data-resolvida="${f.id}">Resolvida</button></li>`).join('') || '<li class="vazio">Nenhuma falha pendente.</li>'}</ul></section>
    <h2 style="margin:28px 0 12px">Registro de alterações</h2>
    <div class="acoes" style="margin-bottom:10px"><select class="busca" id="logFiltro" style="min-width:0"><option value="">Todas as áreas</option>${TABELAS.map(t => `<option value="${t}" ${t === filtroLog ? 'selected' : ''}>${NOMES[t]}</option>`).join('')}</select>
      <small class="mute" style="align-self:center">Últimas 120 alterações. O registro não pode ser editado nem apagado pelo CRM.</small></div>
    <div class="card"><table><thead><tr><th>Quando</th><th>Quem</th><th>O quê</th><th>Detalhes</th><th></th></tr></thead><tbody>${logs.map(linhaLog).join('') || '<tr><td colspan="5" class="vazio">Nada registrado ainda.</td></tr>'}</tbody></table></div>`;

  main.querySelectorAll('[data-resolvida]').forEach(b => b.onclick = async () => { await q(sb.from('crm_falhas').update({ resolvida: true }).eq('id', b.dataset.resolvida)); configuracoes(filtroLog); });
  $('#logFiltro').onchange = e => configuracoes(e.target.value);
  if ($('#mfaAtivar')) $('#mfaAtivar').onclick = () => ativarMfa().then(ok => ok && configuracoes(filtroLog));
  if ($('#mfaDesl')) $('#mfaDesl').onclick = async () => {
    if (!await confirma('Desativar a verificação em duas etapas? O login volta a pedir só a senha.')) return;
    const { error } = await sb.auth.mfa.unenroll({ factorId: totp.id }); if (error) return toast(error.message, true);
    await sb.auth.refreshSession(); toast('Verificação desativada'); configuracoes(filtroLog);
  };
  $('#bkBaixar').onclick = async () => { const a = await gerarBackup(); baixar(a); };
  $('#bkDrive').onclick = async () => {
    try { const ids = await garantirEstrutura(); const a = await gerarBackup(); const f = await subir(a, a.name, ids['15']);
      toast('Backup salvo no Drive: ' + f.name); } catch (e) { toast(e.message, true); }
  };
  const porId = Object.fromEntries(logs.map(l => [String(l.id), l]));
  main.querySelectorAll('[data-restaurar]').forEach(b => b.onclick = async () => {
    const l = porId[b.dataset.restaurar];
    if (!await confirma(`Restaurar o registro apagado em ${NOMES[l.tabela] || l.tabela}?`)) return;
    try { await q(sb.from(l.tabela).insert(l.antes)); toast('Restaurado'); configuracoes(filtroLog); }
    catch { toast('Não deu para restaurar (talvez o item “pai” também tenha sido apagado: restaure ele primeiro).', true); }
  });
}

// título curto do registro alterado e campos que mudaram
function linhaLog(l) {
  const r = l.depois || l.antes || {}, base = l.acao === 'UPDATE' ? {} : r;
  const titulo = base.titulo || base.nome || base.descricao || base.resumo || base.item || '';
  const campos = l.acao === 'UPDATE' ? Object.keys(l.depois || {}).filter(k => k !== 'atualizado_em') : [];
  const [verbo, cor] = ACOES[l.acao];
  const det = l.acao === 'UPDATE' ? campos.map(k => `<b>${esc(k)}</b>: ${esc(curto(l.antes?.[k]))} → ${esc(curto(l.depois?.[k]))}`).join('<br>') : esc(curto(titulo));
  return `<tr><td style="white-space:nowrap"><small>${new Date(l.quando).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></td>
    <td><small class="mute">${esc((l.quem || '').split('@')[0])}</small></td>
    <td><span class="pill ${cor}">${verbo}</span> <small>${esc(NOMES[l.tabela] || l.tabela)}</small></td>
    <td><small>${det}</small></td>
    <td class="dir">${l.acao === 'DELETE' ? `<button class="bt peq sec" data-restaurar="${l.id}">Restaurar</button>` : ''}</td></tr>`;
}
const curto = v => { const s = v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 80 ? s.slice(0, 80) + '…' : s; };

async function ativarMfa() {
  // limpa tentativas anteriores não concluídas (o Supabase recusa nomes repetidos)
  const { data: fat } = await sb.auth.mfa.listFactors();
  for (const f of (fat?.all || []).filter(f => f.status !== 'verified')) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', friendlyName: 'Celular ' + hoje() });
  if (error) { toast(error.message, true); return false; }
  for (let tentativa = 0; ; tentativa++) {
    const v = await formulario('Ativar verificação em duas etapas', [{ k: 'code', l: 'Código de 6 dígitos que aparece no app', req: true }], {},
      `<ol style="margin:0;padding-left:18px;line-height:1.6"><li>Abra o app autenticador no celular e toque em <b>+</b> / <b>Ler QR code</b>.</li><li>Aponte para o código abaixo.</li></ol>
       <img src="${data.totp.qr_code}" alt="QR code" style="width:200px;height:200px;justify-self:center;background:#fff;padding:8px;border-radius:8px">
       <small class="mute" style="text-align:center">Sem câmera? Digite a chave: <code style="user-select:all">${esc(data.totp.secret)}</code></small>
       ${tentativa ? '<p class="atrasado" style="margin:0">Código incorreto. Confira se a hora do celular está certa e tente o código novo.</p>' : ''}`, 'Confirmar');
    if (!v) { await sb.auth.mfa.unenroll({ factorId: data.id }); return false; }
    const { error: e2 } = await sb.auth.mfa.challengeAndVerify({ factorId: data.id, code: v.code.replace(/\D/g, '') });
    if (!e2) { toast('Pronto! A partir de agora o login pede o código.'); return true; }
  }
}

async function gerarBackup() {
  toast('Gerando backup…');
  const dados = {};
  for (const t of TABELAS) {
    let todos = [], de = 0; // pagina de 1000 em 1000 (limite padrão da API)
    for (;;) { const lote = await q(sb.from(t).select('*').range(de, de + 999)); todos = todos.concat(lote); if (lote.length < 1000) break; de += 1000; }
    dados[t] = todos;
  }
  const json = JSON.stringify({ sistema: 'ROVYA OS', gerado_em: new Date().toISOString(), versao: 1, tabelas: dados }, null, 1);
  return new File([json], `ROVYA_BACKUP_${hoje()}.json`, { type: 'application/json' });
}
function baixar(arquivo) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(arquivo); a.download = arquivo.name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000); toast('Backup baixado: ' + arquivo.name);
}
