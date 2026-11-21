// Portal do cliente (rovyacreative.com.br/portal): na ficha do cliente, quem tem acesso, senha provisória e a estratégia de marca.
// Criar login e trocar senha passam pela função crm-portal (precisa da service role); a lista de acessos o CRM lê direto (admin).
import { sb, $, main, esc, q, toast, formulario, confirma, funcao, mdHtml, semRede } from './util.js';

export const LINK_PORTAL = 'https://rovyacreative.com.br/portal';
const quando = d => d ? new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }) : 'ainda não entrou';
const AJUDA_ESTRATEGIA = '<small class="mute">Use <b>## Título</b> para seções e <b>**texto**</b> para negrito. O cliente vê este texto na aba Estratégia do portal.</small>';

export async function cartaoPortal(c) {
  const acessos = await q(sb.from('crm_portal').select('user_id,email,ultimo_acesso').eq('cliente_id', c.id).order('criado_em'));
  return `<section class="card" id="cartaoPortal"><h3>Portal do cliente</h3>
    <ul class="lista">${acessos.map(a => `<li><div class="cresce"><b>${esc(a.email)}</b><small>Último acesso: ${quando(a.ultimo_acesso)}</small></div>
      <button class="bt peq fantasma" data-portal-senha="${a.user_id}">Nova senha</button><button class="bt peq fantasma" data-portal-tirar="${a.user_id}" style="color:var(--bad)">Remover</button></li>`).join('')
      || '<li class="vazio">Sem acesso ao portal.</li>'}</ul>
    <p class="mute" style="margin:8px 0">Estratégia de marca: ${c.estrategia ? 'publicada' : 'ainda não escrita'}</p>
    <div class="acoes"><button class="bt peq sec" id="portalDar">+ Dar acesso</button><button class="bt peq fantasma" id="portalEstrategia">${c.estrategia ? 'Editar' : 'Escrever'} estratégia</button>
      <a class="bt peq fantasma" href="${LINK_PORTAL}" target="_blank" rel="noopener">Abrir portal ↗</a></div></section>`;
}

// mostra a senha provisória uma vez, pronta para mandar
async function mostrarSenha(c, email, senha) {
  const msg = `Olá, ${(c.nome || '').split(' ')[0]}! Seu acesso ao portal da Rovya está pronto ✦\n\n${LINK_PORTAL}\nE-mail: ${email}\nSenha provisória: ${senha}\n\nNo primeiro acesso você escolhe a sua senha.`;
  const zap = c.telefone ? `https://wa.me/${c.telefone.replace(/\D/g, '').replace(/^(?!55)/, '55')}?text=${encodeURIComponent(msg)}` : null;
  const v = formulario('Acesso pronto', [{ k: 'msg', l: 'Mande esta mensagem ao cliente (a senha não aparece de novo)', t: 'textarea', linhas: 9 }], { msg },
    zap ? `<a class="bt sec" href="${esc(zap)}" target="_blank" rel="noopener" style="justify-self:start">Mandar pelo WhatsApp</a>` : '', 'Copiar e fechar');
  if (await v) { await navigator.clipboard.writeText(msg).catch(() => { }); toast('Mensagem copiada'); }
}

const chamar = async (acao, dados) => {
  try { return await funcao('crm-portal', acao, dados); }
  catch (e) { toast(semRede(e) ? 'Sem internet: precisa de conexão.' : e.message, true); return null; }
};

export function ligarPortal(c, recarregar) {
  $('#portalDar').onclick = async () => {
    const v = await formulario('Dar acesso ao portal', [{ k: 'email', l: 'E-mail do cliente', t: 'email', req: true }], { email: c.email },
      '<p class="mute" style="margin:0">O CRM cria o login com uma senha provisória. No primeiro acesso o cliente troca. Ele só vê os projetos, entregas enviadas, arquivos e a estratégia deste cliente.</p>', 'Criar acesso');
    if (!v) return;
    const r = await chamar('convidar', { cliente_id: c.id, email: v.email }); if (!r) return;
    if (r.ja_tinha) toast('Esse e-mail já tinha login (ex.: figurinhas): a senha virou a provisória, por segurança.');
    await mostrarSenha(c, v.email.toLowerCase(), r.senha);
    recarregar();
  };
  main.querySelectorAll('[data-portal-senha]').forEach(b => b.onclick = async () => {
    const email = b.closest('li').querySelector('b').textContent;
    if (!await confirma(`Gerar uma senha nova para ${email}? A senha atual deixa de valer.`)) return;
    const r = await chamar('nova_senha', { user_id: b.dataset.portalSenha }); if (r) await mostrarSenha(c, email, r.senha);
  });
  main.querySelectorAll('[data-portal-tirar]').forEach(b => b.onclick = async () => {
    const email = b.closest('li').querySelector('b').textContent;
    if (!await confirma(`Tirar o acesso de ${email} ao portal?`)) return;
    if (await chamar('remover', { user_id: b.dataset.portalTirar })) { toast('Acesso removido'); recarregar(); }
  });
  $('#portalEstrategia').onclick = async () => {
    const v = await formulario('Estratégia de marca · ' + (c.empresa || c.nome), [{ k: 'estrategia', l: 'Texto que o cliente vê no portal', t: 'textarea', linhas: 18 }], c,
      AJUDA_ESTRATEGIA + (c.estrategia ? `<details><summary class="mute">Como o cliente vê hoje</summary><div class="txt" style="white-space:pre-wrap">${mdHtml(c.estrategia)}</div></details>` : ''));
    if (!v) return;
    await q(sb.from('crm_clientes').update({ estrategia: v.estrategia }).eq('id', c.id)); toast('Estratégia salva'); recarregar();
  };
}
