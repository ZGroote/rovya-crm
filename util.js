// utilidades compartilhadas pelos módulos do CRM (app.js, comercial.js, contratos.js)
import { sb, SUPABASE_URL } from './config.js';
export { sb };

export const $ = s => document.querySelector(s);
export const main = $('#main');
export const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const brl = v => (Number(v) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const diaLocal = (mais = 0) => new Date(Date.now() + mais * 864e5).toLocaleDateString('sv'); // AAAA-MM-DD no fuso local
export const hoje = () => diaLocal();
export const dataBR = d => d ? new Date(d + (d.length === 10 ? 'T12:00' : '')).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : '';
export const venceu = d => d && d < hoje();

export function toast(msg, erro) {
  const t = $('#toast'); t.textContent = msg; t.className = 'on' + (erro ? ' erro' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', 3200);
}
// falha de conexão (e não erro do servidor)
export const semRede = e => !navigator.onLine || /Failed to fetch|NetworkError|Load failed|network/i.test(e?.message || '');
// há login guardado neste aparelho? (permite abrir o CRM sem internet)
export const sessaoSalva = () => { try { return !!localStorage.getItem(`sb-${new URL(SUPABASE_URL).hostname.split('.')[0]}-auth-token`); } catch { return false; } };
export async function q(p) {
  const { data, error } = await p;
  if (error) {
    const escrita = p?.method && !['GET', 'HEAD'].includes(p.method);
    toast(semRede(error) ? (escrita ? 'Sem internet: isso não foi salvo. Tente de novo quando a conexão voltar.' : 'Sem internet e sem cópia salva desta informação.') : error.message, true);
    throw error;
  }
  return data;
}

export const rotulo = (lista, v) => (lista.find(x => x[0] === v) || [, v])[1];

// preenche {{empresa}}, {{contato}}, {{cliente}} com os dados do cliente
export const preencher = (txt, c) => (txt || '')
  .replaceAll('{{empresa}}', c?.empresa || c?.nome || '{{empresa}}')
  .replaceAll('{{contato}}', (c?.nome || '{{contato}}').split(' ')[0])
  .replaceAll('{{cliente}}', c?.nome || '{{cliente}}');

// textos vindos do Trello usam markdown simples (## título, **negrito**)
export const mdHtml = t => esc(t).replace(/^#{1,6}\s*(.+)$/gm, '<b class="tit">$1</b>').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
export const mdTexto = t => (t || '').replace(/^#{1,6}\s*/gm, '').replace(/\*\*(.+?)\*\*/g, '*$1*'); // *negrito* do WhatsApp

/* ---------- formulário genérico em <dialog> ---------- */
// campos: [{k, l, t:'text'|'textarea'|'date'|'time'|'number'|'email'|'select', o:[[v,l]], req, meia, linhas, padrao}]
export function formulario(titulo, campos, val = {}, extra = '', botao = 'Salvar') {
  const dlg = $('#dlg'), f = $('#dlgf');
  const campo = c => {
    const v = val[c.k] ?? c.padrao ?? '';
    const at = `name="${c.k}" ${c.req ? 'required' : ''}`;
    const input = c.t === 'textarea' ? `<textarea ${at} rows="${c.linhas || 5}">${esc(v)}</textarea>`
      : c.t === 'select' ? `<select ${at}>${c.o.map(([ov, ol]) => `<option value="${esc(ov)}" ${String(ov) === String(v) ? 'selected' : ''}>${esc(ol)}</option>`).join('')}</select>`
      : `<input type="${c.t || 'text'}" ${at} value="${esc(v)}" ${c.t === 'number' ? 'step="0.01" min="0"' : ''}>`;
    return `<label>${esc(c.l)}${input}</label>`;
  };
  const html = []; for (let i = 0; i < campos.length; i++) {
    const c = campos[i], d = campos[i + 1];
    if (c.meia && d?.meia) { html.push(`<div class="dupla">${campo(c)}${campo(d)}</div>`); i++; } else html.push(campo(c));
  }
  f.innerHTML = `<h2>${esc(titulo)}</h2>${html.join('')}${extra}
    <div class="rodape"><button class="bt fantasma" value="cancelar" formnovalidate>Cancelar</button><button class="bt" value="ok">${botao}</button></div>`;
  dlg.showModal(); f.querySelector('input,textarea,select')?.focus();
  return new Promise(res => {
    dlg.onclose = () => {
      if (dlg.returnValue !== 'ok') return res(null);
      const o = {}; for (const c of campos) { let v = f.elements[c.k].value.trim(); o[c.k] = v === '' ? null : (c.t === 'number' ? Number(v) : v); }
      res(o);
    };
  });
}
export const confirma = async msg => (await formulario(msg, [], {}, '', 'Confirmar')) !== null;

/* ---------- dados compartilhados ---------- */
export const listaClientes = () => q(sb.from('crm_clientes').select('id,codigo,nome,empresa').order('nome'));
export const opcoesClientes = cs => cs.map(c => [c.id, (c.codigo ? c.codigo + ' · ' : '') + c.nome + (c.empresa ? ` · ${c.empresa}` : '')]);

// chama uma Edge Function do Supabase com o login atual
export async function funcao(nome, acao, dados = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${nome}`, { method: 'POST', headers: { Authorization: 'Bearer ' + session?.access_token, 'Content-Type': 'application/json' }, body: JSON.stringify({ acao, ...dados }) });
  const j = await r.json().catch(() => ({})); if (!r.ok) { const m = j.erro || 'Falha (' + r.status + ')'; registrarFalha(nome, acao, m); throw new Error(m); } return j;
}
// guarda a falha de integração para a Sabrina ver em Configurações (nunca quebra a tela se o registro falhar)
export const registrarFalha = (origem, acao, mensagem) => sb.from('crm_falhas').insert({ origem, acao, mensagem: String(mensagem).slice(0, 500) }).then(() => { }, () => { });

// CSV para o Excel brasileiro (mesma receita do financeiro.js): separador ;, vírgula decimal, BOM UTF-8
export function baixarCsv(linhas, nome) {
  const cel = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const url = URL.createObjectURL(new Blob(['﻿' + linhas.map(l => l.map(cel).join(';')).join('\r\n')], { type: 'text/csv;charset=utf-8' }));
  Object.assign(document.createElement('a'), { href: url, download: nome }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
