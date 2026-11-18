# Gera o CRM de mentira para os testes: _mock.html + _mock/config.js (os dois fora do git).
# Finge o Supabase com dados de exemplo (window.__D), registra cada chamada em window.__log e finge a
# Edge Function do Google (window.__ev): sem internet ela falha como o fetch de verdade.
# Precisa de supabase/002_seed.sql (fica só no computador, fora do git). Rode pelo testes/rodar.py.
import json, os
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
seed = open('supabase/002_seed.sql', encoding='utf-8').read()
est = json.loads(seed[seed.index("'[") + 1:seed.index("]'::jsonb") + 1].replace("''", "'"))
st = ['aprovado', 'aprovado', 'enviado', 'revisao', 'produzindo', 'a_fazer']
etapas = [{'id': f'e{i}', 'ordem': i + 1, 'titulo': e['titulo'], 'orientacao': e['orientacao'],
           'crm_entregas': [{'id': f'x{i}{j}', 'ordem': j + 1, 'titulo': t, 'status': st[min(i + j // 3, 5)] if i < 3 else 'a_fazer',
                             'prazo': '2026-11-1%d' % (j + 1) if i == 1 else None, 'texto': None, 'link': None,
                             'crm_anexos': [{'id': 'a'}] if i == 0 else []} for j, t in enumerate(e['entregas'])]}
          for i, e in enumerate(est)]
cli = [{'id': 'c1', 'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte', 'email': 'paulo@horizonte.com', 'telefone': '(16) 99999-0000', 'instagram': '@horizonte', 'origem': 'Indicação', 'notas': 'Prefere WhatsApp.', 'criado_em': '2026-10-27T10:00:00Z'},
       {'id': 'c2', 'nome': 'Marina Lopes', 'empresa': 'Ateliê Marina', 'email': 'marina@atelie.com', 'telefone': '', 'instagram': '@ateliemarina', 'origem': 'Instagram', 'notas': None, 'criado_em': '2026-11-05T10:00:00Z'},
       {'id': 'c3', 'nome': 'Carla Dias', 'empresa': 'Clínica Dias', 'email': '', 'telefone': '', 'instagram': '', 'origem': 'Site', 'notas': None, 'criado_em': '2026-11-08T10:00:00Z'}]
ops = [{'id': 'o1', 'cliente_id': 'c2', 'titulo': 'Posicionamento + identidade', 'etapa': 'proposta', 'valor': 4800, 'proximo_passo': 'Ligar para tirar dúvidas da proposta', 'proximo_em': '2026-11-11', 'crm_clientes': {'nome': 'Marina Lopes', 'empresa': 'Ateliê Marina'}, 'ordem': 1},
       {'id': 'o2', 'cliente_id': 'c3', 'titulo': 'Comunicação da clínica', 'etapa': 'diagnostico', 'valor': 3500, 'proximo_passo': 'Reunião de diagnóstico', 'proximo_em': '2026-11-14', 'crm_clientes': {'nome': 'Carla Dias', 'empresa': 'Clínica Dias'}, 'ordem': 2},
       {'id': 'o3', 'cliente_id': 'c1', 'titulo': 'Gestão estratégica da comunicação', 'etapa': 'ganho', 'valor': 6000, 'proximo_passo': None, 'proximo_em': None, 'crm_clientes': {'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte'}, 'ordem': 3},
       {'id': 'o4', 'cliente_id': 'c2', 'titulo': 'Kit de stickers', 'etapa': 'contato', 'valor': 900, 'proximo_passo': 'Mandar portfólio', 'proximo_em': '2026-11-13', 'crm_clientes': {'nome': 'Marina Lopes', 'empresa': 'Ateliê Marina'}, 'ordem': 4}]
parc = [{'id': 'p1', 'descricao': '1/3', 'valor': 2000, 'vencimento': '2026-10-28', 'pago_em': '2026-10-28', 'forma': 'Pix'},
        {'id': 'p2', 'descricao': '2/3', 'valor': 2000, 'vencimento': '2026-11-10', 'pago_em': None, 'forma': 'Pix'},
        {'id': 'p3', 'descricao': '3/3', 'valor': 2000, 'vencimento': '2026-12-10', 'pago_em': None, 'forma': 'Pix'}]
proj = {'id': 'pr1', 'cliente_id': 'c1', 'nome': 'Gestão estratégica da comunicação', 'status': 'ativo', 'valor': 6000, 'entrega_prevista': '2026-11-30', 'criado_em': '2026-10-27', 'crm_clientes': cli[0], 'crm_etapas': etapas, 'crm_parcelas': parc}
for p in parc: p['crm_projetos'] = {'id': 'pr1', 'nome': proj['nome']}
# ---- dados extras (serviços, propostas, contratos, Drive, tarefas…) ----
# dados extras da etapa 1 (serviços, propostas, contratos) — executado dentro do mock.py
cli[0].update(codigo='R001', razao_social='Imobiliária Horizonte Ltda', documento='12.345.678/0001-90')
serv = [{'id': 's1', 'codigo': 'SV01', 'nome': 'Gestão estratégica da comunicação', 'categoria': 'Estratégia', 'descricao': 'Diagnóstico, posicionamento e plano de comunicação', 'escopo': '6 etapas', 'entregaveis': 'Diagnóstico\nPlano editorial\nRevista', 'preco': 6000, 'ativo': True},
        {'id': 's2', 'codigo': 'SV02', 'nome': 'Identidade visual', 'categoria': 'Branding', 'descricao': 'Logo, paleta e manual', 'escopo': None, 'entregaveis': 'Logo\nManual', 'preco': 4200, 'ativo': True},
        {'id': 's3', 'codigo': 'SV03', 'nome': 'Kit de stickers', 'categoria': 'Produto', 'descricao': '12 figurinhas', 'escopo': None, 'entregaveis': None, 'preco': 900, 'ativo': False}]
itens = [{'servico_id': 's2', 'nome': 'Identidade visual', 'descricao': 'Logo, paleta e manual', 'qtd': 1, 'preco': 4200},
         {'servico_id': None, 'nome': 'Fotos de produto', 'descricao': '20 fotos', 'qtd': 1, 'preco': 900}]
props = [{'id': 'pp1', 'grupo': 'g1', 'versao': 1, 'cliente_id': 'c2', 'oportunidade_id': 'o1', 'titulo': 'Posicionamento + identidade', 'corpo': '## Sobre o projeto\nOi **Marina**, segue a proposta.', 'itens': itens[:1], 'desconto': 0, 'valor': 4200, 'validade': '2026-11-20', 'status': 'enviada', 'enviada_em': '2026-11-10', 'criado_em': '2026-11-09T10:00:00Z', 'crm_clientes': cli[1]},
         {'id': 'pp2', 'grupo': 'g1', 'versao': 2, 'cliente_id': 'c2', 'oportunidade_id': 'o1', 'titulo': 'Posicionamento + identidade', 'corpo': '## Sobre o projeto\nOi **Marina**, segue a proposta revisada.', 'itens': itens, 'desconto': 300, 'valor': 4800, 'validade': '2026-11-30', 'status': 'rascunho', 'enviada_em': None, 'criado_em': '2026-11-14T10:00:00Z', 'crm_clientes': cli[1]},
         {'id': 'pp3', 'grupo': 'g2', 'versao': 1, 'cliente_id': 'c3', 'oportunidade_id': 'o2', 'titulo': 'Comunicação da clínica', 'corpo': '', 'itens': [], 'desconto': 0, 'valor': 3500, 'validade': '2026-11-12', 'status': 'enviada', 'enviada_em': '2026-11-05', 'criado_em': '2026-11-05T10:00:00Z', 'crm_clientes': cli[2]}]
contr = [{'id': 'k1', 'cliente_id': 'c1', 'proposta_id': None, 'projeto_id': 'pr1', 'titulo': 'Gestão estratégica da comunicação', 'tipo': 'misto', 'inicio': '2026-10-27', 'fim': '2026-12-05', 'valor_mensal': 1500, 'valor_avulso': 6000, 'renovacao_auto': False, 'aviso_dias': 30, 'status': 'vigente', 'link_assinado': None, 'arquivo': None, 'notas': None, 'criado_em': '2026-10-27T10:00:00Z', 'crm_clientes': cli[0]},
         {'id': 'k2', 'cliente_id': 'c2', 'proposta_id': 'pp1', 'projeto_id': None, 'titulo': 'Identidade visual', 'tipo': 'avulso', 'inicio': '2026-11-15', 'fim': '2027-01-15', 'valor_mensal': None, 'valor_avulso': 4800, 'renovacao_auto': False, 'aviso_dias': 30, 'status': 'assinatura', 'link_assinado': None, 'arquivo': None, 'notas': None, 'criado_em': '2026-11-01T10:00:00Z', 'crm_clientes': cli[1]}]
modelo_prop = {'id': 'm3', 'tipo': 'proposta', 'titulo': 'Proposta padrão', 'corpo': '## Olá, {{contato}}\nProposta para a **{{empresa}}**.'}
cli[0].update(drive_pasta='PASTA_R001', drive_subpastas={'01': 'a', '03': 'b'})
for c in cli[1:]: c.update(drive_pasta=None, drive_subpastas={})
drive = [{'chave': 'raiz', 'folder_id': 'RAIZ', 'nome': 'ROVYA — GESTÃO EMPRESARIAL'}] + [{'chave': '%02d' % i, 'folder_id': 'A%02d' % i, 'nome': 'x'} for i in range(18)]
docs = [{'id': 'd1', 'drive_id': 'f1', 'nome': 'ROVYA_R001_PROPOSTA_2026-11-15_V01.pdf', 'link': 'https://drive.google.com/file/d/f1', 'tipo': 'PROPOSTA', 'subpasta': '03', 'versao': 1, 'classificacao': 'cliente', 'cliente_id': 'c1', 'proposta_id': 'pp1', 'contrato_id': None, 'criado_em': '2026-11-15T12:00:00Z', 'crm_clientes': {'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte'}},
        {'id': 'd2', 'drive_id': 'f2', 'nome': 'ROVYA_R001_CONTRATO_2026-11-15_V01.pdf', 'link': 'https://drive.google.com/file/d/f2', 'tipo': 'CONTRATO', 'subpasta': '03', 'versao': 1, 'classificacao': 'confidencial', 'cliente_id': 'c1', 'proposta_id': None, 'contrato_id': 'k1', 'criado_em': '2026-11-15T12:00:00Z', 'crm_clientes': {'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte'}}]
cli[0].update(cliente_desde='2026-10-27', onboarding=[{'item': 'Contrato assinado', 'feito': True}, {'item': 'Pasta no Drive criada', 'feito': True}, {'item': 'Briefing recebido', 'feito': False}],
              crm_interacoes=[{'id': 'h1', 'tipo': 'reuniao', 'data': '2026-11-10', 'resumo': 'Kickoff: alinhamos o cronograma da revista.', 'criado_em': '2026-11-10T10:00:00Z'},
                              {'id': 'h2', 'tipo': 'ligacao', 'data': '2026-10-20', 'resumo': 'Primeira conversa, veio por indicação.', 'criado_em': '2026-10-20T10:00:00Z'}])
for c in cli[1:]: c.update(cliente_desde=None, onboarding=None, crm_interacoes=[])
tarefas = [{'id': 't1', 'projeto_id': 'pr1', 'cliente_id': 'c1', 'titulo': 'Revisar textos da revista', 'descricao': None, 'prioridade': 'alta', 'prazo': '2026-11-14', 'status': 'a_fazer', 'link': 'https://drive.google.com', 'concluida_em': None, 'criado_em': '2026-11-10T10:00:00Z', 'crm_projetos': {'id': 'pr1', 'nome': 'Gestão estratégica da comunicação'}, 'crm_clientes': {'id': 'c1', 'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte'}},
           {'id': 't2', 'projeto_id': None, 'cliente_id': None, 'titulo': 'Renovar assinatura do Canva', 'descricao': None, 'prioridade': 'media', 'prazo': '2026-11-18', 'status': 'fazendo', 'link': None, 'concluida_em': None, 'criado_em': '2026-11-10T10:00:00Z', 'crm_projetos': None, 'crm_clientes': None},
           {'id': 't3', 'projeto_id': None, 'cliente_id': None, 'titulo': 'Organizar portfólio', 'descricao': None, 'prioridade': 'baixa', 'prazo': None, 'status': 'feita', 'link': None, 'concluida_em': '2026-11-12', 'criado_em': '2026-11-01T10:00:00Z', 'crm_projetos': None, 'crm_clientes': None}]
for x in parc: x.update(tipo='receita', categoria='Projeto', cliente_id='c1', contrato_id='k1')
parc.append({'id': 'p4', 'descricao': 'Canva Pro', 'valor': 55, 'vencimento': '2026-11-08', 'pago_em': '2026-11-08', 'forma': 'Cartão', 'tipo': 'despesa', 'categoria': 'Ferramentas e assinaturas', 'cliente_id': None, 'contrato_id': None, 'projeto_id': None, 'crm_projetos': None})
parc.append({'id': 'p5', 'descricao': 'DAS MEI', 'valor': 76.6, 'vencimento': '2026-11-20', 'pago_em': None, 'forma': 'Boleto', 'tipo': 'despesa', 'categoria': 'Impostos', 'cliente_id': None, 'contrato_id': None, 'projeto_id': None, 'crm_projetos': None})
logs = [{'id': 3, 'quando': '2026-11-15T14:02:00Z', 'quem': 'rovyacreative@gmail.com', 'tabela': 'crm_tarefas', 'registro': 't9', 'acao': 'DELETE', 'antes': {'id': 't9', 'titulo': 'Ligar para a gráfica', 'status': 'a_fazer', 'prioridade': 'media'}, 'depois': None},
        {'id': 2, 'quando': '2026-11-15T13:40:00Z', 'quem': 'rovyacreative@gmail.com', 'tabela': 'crm_oportunidades', 'registro': 'o1', 'acao': 'UPDATE', 'antes': {'etapa': 'diagnostico', 'atualizado_em': 'x'}, 'depois': {'etapa': 'proposta', 'atualizado_em': 'y'}},
        {'id': 1, 'quando': '2026-11-15T13:00:00Z', 'quem': 'rovyacreative@gmail.com', 'tabela': 'crm_clientes', 'registro': 'c3', 'acao': 'INSERT', 'antes': None, 'depois': {'id': 'c3', 'nome': 'Carla Dias'}}]
# estrutura do Drive: 16 e 17 ainda sem pasta
drive = [{'chave': 'raiz', 'folder_id': 'RAIZ', 'nome': 'ROVYA'}] + [{'chave': '%02d' % i, 'folder_id': ('A%02d' % i) if i < 16 else None, 'nome': '%02d — Área %d' % (i, i)} for i in range(18)]
# ----

# etapa 5: formato/revisões nas peças, produção, falhas
FM=['Post feed','Carrossel','Reels / vídeo',None]
for e in etapas:
    for j,x in enumerate(e['crm_entregas']):
        x.update(formato=FM[j%4], revisoes=(2 if x['status']=='revisao' else 0), aprovado_em=('2026-11-10T12:00:00Z' if x['status']=='aprovado' else None))
pinfo={'id':'pr1','nome':proj['nome'],'status':'ativo','crm_clientes':{'id':'c1','nome':'Paulo Mendes','empresa':'Imobiliária Horizonte'}}
ents = [{**x, 'crm_etapas': {'titulo': e['titulo'], 'projeto_id': 'pr1', 'crm_projetos': pinfo}} for e in etapas for x in e['crm_entregas']]
D = {'crm_clientes': [{**c, 'crm_projetos': [{'id': 'pr1', 'nome': proj['nome'], 'status': 'ativo', 'valor': 6000}] if c['id'] == 'c1' else [], 'crm_oportunidades': [o for o in ops if o['cliente_id'] == c['id']]} for c in cli],
     'crm_oportunidades': ops, 'crm_projetos': [proj], 'crm_entregas': ents, 'crm_parcelas': parc,
     'crm_servicos': serv, 'crm_propostas': props, 'crm_contratos': contr, 'crm_drive': drive, 'crm_documentos': docs, 'crm_tarefas': tarefas, 'crm_log': logs, 'crm_falhas': [{'id':1,'quando':'2026-11-16T11:00:00Z','origem':'drive','acao':'POST /upload/drive/v3/files','mensagem':'Drive: Insufficient Permission','resolvida':False}], 'crm_interacoes': cli[0]['crm_interacoes'],
     'crm_anexos': [{'id': 'a', 'nome': 'Revista.pdf', 'caminho': 'x', 'tamanho': 5200000}],
     'crm_modelos': [{'id': 'm1', 'tipo': 'projeto', 'titulo': 'Gestão estratégica da comunicação', 'corpo': 'Estrutura completa usada no projeto Imobiliária Horizonte (out/2026): 6 etapas.', 'estrutura': est},
                     modelo_prop, {'id': 'm2', 'tipo': 'whatsapp', 'titulo': 'Primeiro contato', 'corpo': 'Oi, {{contato}}! Aqui é a Sabrina, da Rovya. Vi o trabalho da {{empresa}} e…'}]}
EV = {'conectado': True, 'email': 'rovyacreative@gmail.com', 'eventos': [
    {'id': 'g1', 'summary': 'Reunião de diagnóstico · Clínica Dias', 'start': {'dateTime': '2026-11-12T14:00:00-03:00'}, 'end': {'dateTime': '2026-11-12T15:00:00-03:00'}, 'extendedProperties': {'private': {'crm_cliente': 'c3'}}},
    {'id': 'g2', 'summary': 'Academia', 'start': {'dateTime': '2026-11-12T18:30:00-03:00'}, 'end': {'dateTime': '2026-11-12T19:30:00-03:00'}},
    {'id': 'g3', 'summary': 'Apresentação proposta · Ateliê Marina', 'start': {'dateTime': '2026-11-14T10:00:00-03:00'}, 'end': {'dateTime': '2026-11-14T11:00:00-03:00'}, 'location': 'Google Meet', 'extendedProperties': {'private': {'crm_cliente': 'c2'}}}]}
js = """// SÓ PARA TESTE VISUAL: finge o Supabase com dados de exemplo
export const SUPABASE_URL = 'http://mock';
const D = %s, EV = %s;
window.__log = []; window.__D = D; const chain = t => { const st = { eq: {}, um: false }; const c = new Proxy({}, { get: (o, k) => { if (k === 'then') { let d = D[t] || []; if (st.um) d = d.find(r => r.id === st.eq.id) ?? null; const p = Promise.resolve({ data: d, error: null }); return p.then.bind(p); } return (...a) => { window.__log.push([t, k, a]); if (k === 'eq') st.eq[a[0]] = a[1]; if (k === 'maybeSingle' || k === 'single') st.um = true; return c; }; } }); return c; };
export const sb = { from: chain, rpc: n => Promise.resolve({ data: n === 'is_admin' ? true : 'pr1', error: null }),
  auth: { getSession: async () => ({ data: { session: { access_token: 'x' } } }), signOut: async () => {}, refreshSession: async () => ({}), mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: 'aal1', nextLevel: 'aal1' } }), listFactors: async () => ({ data: { totp: [], all: [] } }), enroll: async () => ({ data: { id: 'f1', totp: { qr_code: '', secret: 'ABCD1234' } } }), challengeAndVerify: async () => ({}), unenroll: async () => ({}) } },
  storage: { from: () => ({ createSignedUrl: async () => ({ data: { signedUrl: '#' } }), upload: async () => ({}), remove: async () => ({}) }) } };
const f0 = window.fetch; window.__ev = []; window.__EV = EV;
const amanha = d => { const x = new Date(); x.setDate(x.getDate() + 1); const [h, m] = d.split(':'); x.setHours(+h, +m, 0, 0); return x.toISOString(); };
EV.eventos.push({ id: 'g9', summary: 'Dentista', start: { dateTime: amanha('10:30') }, end: { dateTime: amanha('11:30') } });
window.fetch = (u, o) => {
  if (!String(u).includes('functions/v1')) return f0(u, o);
  if (!navigator.onLine) return Promise.reject(new TypeError('Failed to fetch'));
  const b = JSON.parse(o.body); window.__ev.push(b);
  if (b.acao === 'listar') { const de = new Date(b.de), ate = new Date(b.ate);
    return Promise.resolve(new Response(JSON.stringify({ ...EV, eventos: EV.eventos.filter(e => new Date(e.start.dateTime) < ate && new Date(e.end.dateTime) > de) }))); }
  if (b.acao === 'url') return Promise.resolve(new Response(JSON.stringify({ url: '#/agenda' })));
  if (b.acao === 'criar') { const e = { id: 'n' + window.__ev.length, ...b.evento, _agenda: b.agenda, _tipo: b.agenda === 'pessoal' ? 'pessoal' : 'profissional' }; if (e.conferenceData) e.hangoutLink = 'https://meet.google.com/abc-defg-hij'; EV.eventos.push(e); return Promise.resolve(new Response(JSON.stringify(e))); }
  if (b.acao === 'agendas') return Promise.resolve(new Response(JSON.stringify({ faltam: [], config: { profissional: 'primary', pessoal: EV.temPessoal ? 'pes1' : null, mostrar: [] },
    lista: [{ id: 'rovyacreative@gmail.com', nome: 'Rovya', principal: true, papel: 'owner' }, { id: 'pes1', nome: 'Pessoal', papel: 'owner' }, { id: 'feriados', nome: 'Feriados no Brasil', papel: 'reader' }] })));
  if (b.acao === 'salvar_agendas') { EV.temPessoal = !!b.agendas.pessoal; return Promise.resolve(new Response(JSON.stringify({ ok: true }))); }
  if (b.acao === 'criar_agenda') return Promise.resolve(new Response(JSON.stringify({ id: 'pes1' })));
  if (b.acao === 'contatos') return Promise.resolve(new Response(JSON.stringify({ contatos: [
    { nome: 'Paulo Mendes', email: 'PAULO@horizonte.com', telefone: '', empresa: '' }, { nome: 'Joana Prado', email: 'joana@prado.com', telefone: '+55 16 98888-1111', empresa: 'Prado Café' },
    { nome: 'Rui Costa', email: '', telefone: '(16) 97777-2222', empresa: '' }, { nome: 'Lia Souza', email: 'lia@souza.com', telefone: '', empresa: 'Souza Arquitetura' }] })));
  if (b.acao === 'email') return Promise.resolve(new Response(JSON.stringify({ ok: true })));
  if (b.acao === 'chat') { const u = b.mensagens.at(-1).content, ac = (nome, args) => ({ nome, args });
    const acoes = /tarefa/i.test(u) ? [ac('criar_tarefa', { rotulo: 'Tarefa: ligar para a Marina (sex, 20/11)', titulo: 'Ligar para a Marina', prazo: '2026-11-20', prioridade: 'alta', cliente_id: 'c2' })]
      : /move/i.test(u) ? [ac('mover_oportunidade', { rotulo: 'Clínica Dias para Negociação', oportunidade_id: 'o2', etapa: 'negociacao' })]
      : /whats/i.test(u) ? [ac('escrever_whatsapp', { rotulo: 'WhatsApp para o Paulo', cliente_id: 'c1', texto: 'Oi, Paulo! Tudo bem?' }), ac('escrever_email', { rotulo: 'E-mail para o Paulo', cliente_id: 'c1', assunto: 'Retorno', texto: 'Oi, Paulo!' })] : [];
    return new Promise(ok => setTimeout(ok, 600, new Response(JSON.stringify({ resposta: acoes.length ? 'Preparei para você conferir:' : b.mensagens.length > 1 ? 'Você tem **R$ 2.000,00** a receber.' : '**Hoje:** 2 tarefas e 1 compromisso.', acoes })))); }
  return Promise.resolve(new Response('{}'));
};
""" % (json.dumps(D, ensure_ascii=False), json.dumps(EV, ensure_ascii=False))
open('_mock/config.js', 'w', encoding='utf-8').write(js)
import re
h = re.sub(r'<link rel="stylesheet" href="app.css[^"]*">', lambda m: m.group(0) + '<script type="importmap">{"imports":{"http://localhost:8777/config.js":"/_mock/config.js"}}</script><style>.entrada{display:none}</style>', open('app.html', encoding='utf-8').read())
open('_mock.html', 'w', encoding='utf-8').write(h)
print('ok')
