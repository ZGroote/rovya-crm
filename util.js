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
  clearTimeout(toast.t); toast.t = setTimeout(() => t.className = '', msg.length > 90 ? 7000 : 3200); // mensagem longa: tempo de ler
}
// anexos ficam no Storage do Supabase (1 GB no plano grátis, dividido com o rovya-stickers); arquivo grande vai para o Drive.
// O mesmo limite está no bucket (supabase/012_limite_anexos.sql), que recusa mesmo se a tela for contornada.
export const LIMITE_ANEXO_MB = 50;
export function anexosGrandes(arquivos) {
  const grandes = [...arquivos].filter(f => f.size > LIMITE_ANEXO_MB * 1048576);
  if (grandes.length) toast(`${grandes.map(f => `“${f.name}” tem ${Math.ceil(f.size / 1048576)} MB`).join(', ')}: o limite é ${LIMITE_ANEXO_MB} MB. Arquivos grandes vão pelo Drive (ficha do cliente → Enviar ao Drive).`, true);
  return grandes.length > 0;
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

/* ---------- escrita sem internet (tarefas e registro de contato) ----------
   Sem conexão, a mudança fica numa fila no aparelho e as telas já a mostram (com ⏳). Quando a conexão volta,
   vai para o banco na ordem em que foi feita. Se o mesmo campo mudou em outro aparelho nesse meio tempo, a mudança
   dela vale (nada se perde; o valor anterior fica no registro de alterações) e vira um aviso. */
const FILA_ESC = 'rovya-escritas-pendentes';
export const lerEscritas = () => { try { return JSON.parse(localStorage.getItem(FILA_ESC)) || []; } catch { return []; } };
const gravarEscritas = f => localStorage.setItem(FILA_ESC, JSON.stringify(f));
export const limparEscritas = () => { try { localStorage.removeItem(FILA_ESC); } catch { } };
export const campos = (linha, ks) => Object.fromEntries(ks.map(k => [k, linha?.[k] ?? null]));
async function executar({ tabela, acao, id, dados }) {
  const t = sb.from(tabela);
  const { error } = await (acao === 'insert' ? t.insert(dados) : acao === 'update' ? t.update(dados).eq('id', id) : t.delete().eq('id', id));
  if (error && !(acao === 'insert' && error.code === '23505')) throw error; // 23505: já entrou numa tentativa que perdeu a resposta
}
// op: { tabela, acao: 'insert'|'update'|'delete', id?, dados?, antes? (campos como ela viu, para achar conflito), rotulo }
// devolve 'guardado' (ficou no aparelho) ou true (foi para o banco)
export async function salvar(op) {
  if (op.acao === 'insert') { op.dados = { id: crypto.randomUUID(), ...op.dados }; op.id = op.dados.id; } // id daqui: reenviar não duplica
  if (navigator.onLine) {
    try { await executar(op); return true; }
    catch (e) { if (!semRede(e)) { toast(e.message, true); throw e; } }
  }
  try { gravarEscritas([...lerEscritas(), { ...op, k: Date.now() + Math.random().toString(36).slice(2), em: new Date().toISOString() }]); }
  catch (e) { toast('Sem internet e sem espaço neste aparelho: não foi salvo.', true); throw e; }
  toast('Sem internet: guardado neste aparelho. Vai para o banco quando a conexão voltar.');
  return 'guardado';
}
// as telas leem da cópia (ou do banco) e passam por aqui para já mostrar o que ela fez sem internet
export function comPendentes(tabela, linhas, filtro = () => true) {
  let out = [...linhas];
  for (const op of lerEscritas()) if (op.tabela === tabela) {
    if (op.acao === 'insert') { if (!out.some(r => r.id === op.id)) out.push({ criado_em: op.em, ...op.dados, _pendente: true }); }
    else if (op.acao === 'update') out = out.map(r => r.id === op.id ? { ...r, ...op.dados, _pendente: true } : r);
    else out = out.filter(r => r.id !== op.id);
  }
  return out.filter(filtro);
}
// envia a fila; devolve quantas foram
export function enviarEscritas() {
  if (!navigator.onLine || !lerEscritas().length) return Promise.resolve(0);
  const rodar = async () => {
    let n = 0;
    const tirar = k => { try { gravarEscritas(lerEscritas().filter(x => x.k !== k)); } catch { } };
    for (const op of lerEscritas()) {
      try {
        if (op.acao === 'update' && op.antes) {
          const { data, error } = await sb.from(op.tabela).select(Object.keys(op.antes).join(',')).eq('id', op.id).maybeSingle();
          if (error) throw error;
          if (!data) { registrarFalha('sem internet', op.acao, `${op.rotulo}: foi alterado sem internet, mas já tinha sido apagado em outro aparelho. A alteração não foi aplicada.`); tirar(op.k); continue; }
          const mudou = Object.keys(op.antes).filter(k => JSON.stringify(data[k] ?? null) !== JSON.stringify(op.antes[k]));
          if (mudou.length) registrarFalha('sem internet', 'conflito', `${op.rotulo}: foi alterado sem internet, mas ${mudou.join(', ')} já tinha mudado em outro aparelho. Ficou a versão feita sem internet; a anterior está em Configurações → Registro de alterações.`);
        }
        await executar(op); tirar(op.k); n++;
      } catch (e) {
        if (semRede(e)) break;
        if (/^2[23]/.test(e.code || '')) { // dado recusado pelo banco (ex.: projeto apagado): não adianta repetir
          registrarFalha('sem internet', op.acao, `${op.rotulo}: feito sem internet, mas o banco recusou (${e.message}). Refaça pela tela.`); tirar(op.k); continue;
        }
        break; // outro erro (login vencendo, servidor fora): tenta de novo mais tarde, na mesma ordem
      }
    }
    return n;
  };
  return navigator.locks ? navigator.locks.request('rovya-escritas', { ifAvailable: true }, l => l ? rodar() : 0) : rodar();
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
