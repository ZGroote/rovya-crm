# Fluxo (024): próximos passos no Início, escopo do contrato, mês seguinte, status permitidos e proposta aceita online.
import sys, json, datetime, pathlib
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
U = 'http://localhost:8777/_mock.html'
hoje = datetime.date.today()
MES = hoje.strftime('%Y-%m')
SEG = (hoje.replace(day=28) + datetime.timedelta(days=4)).replace(day=1).strftime('%Y-%m')
espera_meses = [MES] + ([SEG] if hoje.day >= 20 and SEG <= '2026-12' else [])  # k1 vai até 05/12/2026
rpcs = lambda pg: pg.evaluate("window.__log.filter(([t, n]) => t === 'rpc' && n === 'crm_projeto_de_modelo').map(x => x[2][0])")
PREPARA = """(h) => { const D = window.__D, antigo = '2026-11-01T10:00:00Z';
  Object.assign(D.crm_contratos[0], { posts_mes: 12, ajustes_inclusos: 1 });             // k1: mensal (misto), vigente até 05/12
  Object.assign(D.crm_propostas[2], { status: 'aprovada', aceite_em: '2026-11-21T15:00:00Z', aceite_nome: 'Carla Dias' }); // pp3 aceita, sem contrato
  D.crm_entregas.forEach(x => { Object.assign(x.crm_etapas.crm_projetos, { cliente_id: 'c1', contrato_id: 'k1', mes: null }); x.crm_etapas.crm_projetos.crm_clientes.telefone = '(16) 99999-0000'; });
  const env = D.crm_entregas.filter(x => x.status === 'enviado'); env.forEach(x => x.atualizado_em = antigo);
  const rev = D.crm_entregas.find(x => x.status === 'revisao'); rev.revisoes = 2;
  const apr = D.crm_entregas.find(x => x.status === 'aprovado'); apr.prazo = h;
  return { env: env.length, rev: rev.titulo, apr: apr.titulo }; }"""
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))

    # 1) Início: próximos passos
    pg.goto(U + '#/clientes'); pg.wait_for_selector('tr[data-id]')
    info = pg.evaluate(PREPARA, hoje.isoformat())
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    txt = pg.inner_text('#cFluxo')
    ok('Proposta aceita online: falta o contrato' in txt and 'Clínica Dias' in txt, 'proposta aceita sem contrato aparece')
    ok('Contrato sem projeto' in txt and 'Identidade visual' in txt, 'contrato avulso sem projeto aparece')
    ok('Fechado no funil, sem projeto' in txt, 'cartão fechado no funil sem projeto aparece (formulário cancelado não some)')
    rot = {'2026-11': 'Novembro 2026', '2026-12': 'Dezembro 2026'}
    ok(all(f'Criar {rot.get(m, m)}' in txt for m in espera_meses), 'contrato mensal sem o mês: ' + ', '.join(espera_meses))
    ok((pg.locator('#todosMeses').count() == 1) == (len(espera_meses) > 1), 'botão "criar todos" só com mais de um mês')
    ok(f"{info['env']} peças esperando aprovação" in txt or f"{info['env']} peça esperando" in txt, 'peças enviadas há dias sem resposta: ' + str(info['env']))
    ok('Lembrar o cliente' in txt and 'sem acesso ao portal' in txt, 'oferece lembrar o cliente (mesmo aviso do envio)')
    nrev = pg.evaluate("window.__D.crm_entregas.filter(x => x.status === 'revisao' && x.revisoes > 1).length")
    ok((f'{nrev} peças com ajuste além do combinado (contrato inclui 1)' if nrev > 1 else 'Ajuste além do combinado: 2ª rodada (contrato inclui 1)') in txt and txt.count('além do combinado') == 1, f'ajuste além do combinado: um aviso por projeto ({nrev} peças)')
    ok('Publicar hoje: ' + info['apr'] in txt, 'aprovado com data de hoje: publicar hoje')
    ok('preparar renovação' in txt, 'contrato perto do fim sem proposta: preparar renovação')
    # proposta de OUTRO serviço do mesmo cliente não esconde a renovação; a proposta ligada ao contrato esconde (recusada não)
    pg.evaluate("() => { window.__D.crm_propostas.push({ id: 'ppx', grupo: 'gx', versao: 1, cliente_id: 'c1', titulo: 'Fotos de produto', status: 'enviada', criado_em: new Date().toISOString(), crm_clientes: window.__D.crm_clientes[0] }); location.hash = '#/clientes'; }")
    pg.wait_for_selector('tr[data-id]'); pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    ok('preparar renovação' in pg.inner_text('#cFluxo'), 'proposta de outro serviço não esconde a renovação')
    pg.locator('#cFluxo li', has_text='preparar renovação').locator('button').click(); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    np = pg.evaluate("window.__log.filter(([t, k]) => t === 'crm_propostas' && k === 'insert').map(x => x[2][0]).at(-1)")
    ok(np and np['renova_contrato'] == 'k1' and np['titulo'].startswith('Renovação'), 'Preparar proposta cria a proposta ligada ao contrato que ela renova')
    pg.evaluate("() => { window.__D.crm_propostas.at(-1).renova_contrato = 'k1'; window.__D.crm_propostas.at(-1).status = 'recusada'; location.hash = '#/clientes'; }")
    pg.wait_for_selector('tr[data-id]'); pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    ok('preparar renovação' in pg.inner_text('#cFluxo'), 'renovação recusada: o aviso volta')
    pg.evaluate("() => { window.__D.crm_propostas.at(-1).status = 'enviada'; window.__D.crm_propostas.pop(); window.__D.crm_propostas.push({ id: 'ppr', grupo: 'gr', versao: 1, cliente_id: 'c1', renova_contrato: 'k1', titulo: 'Renovação', status: 'enviada', criado_em: new Date().toISOString(), crm_clientes: window.__D.crm_clientes[0] }); location.hash = '#/clientes'; }")
    pg.wait_for_selector('tr[data-id]'); pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    ok('preparar renovação' not in pg.inner_text('#cFluxo'), 'com a proposta de renovação deste contrato, o aviso some')
    pg.evaluate("() => { window.__D.crm_propostas = window.__D.crm_propostas.filter(p => !['ppx', 'ppr'].includes(p.id)); }")
    ok('Funil: próximos contatos' in pg.inner_text('#main'), 'o cartão antigo do funil continua, com nome novo')
    # lembrar: abre o mesmo aviso do envio (cliente com acesso ao portal → WhatsApp com o texto aprovado)
    pg.evaluate("() => { window.__D.crm_portal = [{ cliente_id: 'c1', ultimo_acesso: null }]; }")
    pg.route('**/wa.me/**', lambda r: r.abort())
    pg.locator('#cFluxo li', has_text='esperando aprovação').locator('button').click(); pg.wait_for_selector('#dlgf .aviso [data-zap]')
    with pg.expect_popup() as aba_zap: pg.click('#dlgf .aviso [data-zap]')
    aba_zap.value.close()  # a aba do WhatsApp (bloqueada no teste) é fechada para o CRM voltar a ter o foco
    href = pg.get_attribute('#dlgf .aviso [data-zap]', 'href')
    ok('wa.me/5516999990000' in href and 'portal' in href and 'Temos' in pg.input_value('#dlgf .aviso [data-texto]') and pg.is_visible('#dlgf [data-sim]'),
       'Lembrar o cliente: WhatsApp do cliente com a mensagem aprovada e o link do portal, e pergunta "Mandou?"')
    pg.evaluate("() => { delete window.__D.crm_portal; }")
    pg.click('#dlgf button[value=ok]'); pg.wait_for_function("!document.querySelector('#dlg').open")
    pg.wait_for_timeout(2000)  # depois do aviso o Início se redesenha (2 vezes); espera assentar antes do próximo clique

    # criar contrato a partir da proposta aceita
    pg.locator('#cFluxo li', has_text='falta o contrato').locator('button').click(); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=cliente_id]') == 'c3' and pg.input_value('#dlgf [name=titulo]') == 'Comunicação da clínica', 'contrato já vem com cliente e título da proposta')
    ok(pg.locator('#dlgf [name=posts_mes]').count() == 1 and pg.locator('#dlgf [name=ajustes_inclusos]').count() == 1, 'contrato tem os campos de escopo')
    pg.fill('#dlgf [name=posts_mes]', '12.4'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ins = pg.evaluate("window.__log.filter(([t, k]) => t === 'crm_contratos' && k === 'insert').map(x => x[2][0]).at(-1)")
    ok(ins and ins['proposta_id'] == 'pp3' and ins['posts_mes'] == 12, 'contrato criado ligado à proposta, escopo inteiro: ' + json.dumps(ins and {k: ins[k] for k in ('proposta_id', 'posts_mes')}))

    # criar o mês pelo Início
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    pg.locator('#cFluxo li', has_text=f"Criar {rot.get(MES, MES)}").locator('button').click(); pg.wait_for_function("location.hash === '#/projeto/pr1'")
    a = rpcs(pg)[-1]; posts = sum(len(e['entregas']) for e in a['p_estrutura'] if not e.get('consulta'))
    ok(a['p_contrato'] == 'k1' and a['p_mes'] == MES and a['p_valor'] == 1500 and posts == 12, f'mês criado ligado ao contrato, com os 12 posts do escopo ({posts})')
    ok(a['p_nome'] == f"Imobiliária Horizonte · {rot.get(MES, MES)}" and a['p_entrega'].startswith(MES), 'nome com o mês e entrega no fim do mês: ' + a['p_entrega'])

    # contrato sem projeto → projeto numa gravação só (contrato, valor, entrega)
    pg.evaluate("location.hash = '#/'"); pg.wait_for_selector('#cFluxo')
    pg.locator('#cFluxo li', has_text='Contrato sem projeto').locator('button').click(); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#dlgf [name=modelo]', ''); pg.fill('#dlgf [name=entrega_prevista]', '2027-01-15'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    a = rpcs(pg)[-1]
    ok(a['p_contrato'] == 'k2' and a['p_valor'] == 4800 and a['p_entrega'] == '2027-01-15' and a['p_mes'] is None, 'projeto do contrato avulso: contrato, valor e entrega na mesma gravação')
    ok(not pg.evaluate("window.__log.some(([t, k, a]) => (t === 'crm_projetos' || t === 'crm_contratos') && k === 'update')"), 'nenhuma segunda gravação para ligar contrato ou valor')

    # 2) contrato: escopo e status permitidos
    pg.evaluate("() => { Object.assign(window.__D.crm_projetos[0], { mes: '2026-11', contrato_id: 'k1' }); location.hash = '#/contrato/k1'; }")
    pg.wait_for_selector('#st')
    ok(pg.evaluate("[...document.querySelectorAll('#st option')].map(o => o.value).join()") == 'vigente,encerrado,cancelado', 'contrato vigente só oferece encerrar ou cancelar')
    esc = pg.inner_text('#main')
    ok('Escopo' in esc and '12 posts por mês' in esc and 'Novembro 2026' in esc and 'de 12 posts' in esc, 'cartão Escopo mostra o mês e o uso')
    ok('ajuste' in esc and 'além do combinado' in esc and 'acima do contrato' in esc, 'mostra ajustes além do combinado')
    ok(pg.locator('#nProj').count() == 0, 'contrato mensal não tem "Criar projeto" (tem os meses)')
    pg.select_option('#st', 'cancelado'); pg.wait_for_selector('#dlg[open]')
    ok('não volta a vigente' in pg.inner_text('#dlgf'), 'cancelar pede confirmação e avisa que não volta')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(300)
    ok(not pg.evaluate("window.__log.some(([t, k, a]) => t === 'crm_contratos' && k === 'update' && a[0].status === 'cancelado')"), 'desistiu: nada muda')

    # 3) produção: faixa do escopo do mês
    pg.evaluate("() => { window.__D.crm_entregas.forEach(x => x.crm_etapas.crm_projetos.mes = '%s'); location.hash = '#/producao'; }" % MES); pg.wait_for_selector('.col')
    ok(pg.locator('a.linkcard[href="#/contrato/k1"]').count() == 1 and 'de 12 posts' in pg.inner_text('a.linkcard[href="#/contrato/k1"]'), 'Produção mostra o uso do escopo do mês por contrato')

    # 4) proposta: status permitidos e link de aceite
    pg.evaluate("() => { Object.assign(window.__D.crm_propostas[2], { status: 'enviada', aceite_em: null, token: 'ab'.repeat(16) }); window.__D.crm_propostas = [window.__D.crm_propostas[2]]; location.hash = '#/proposta/pp3'; }")
    pg.wait_for_selector('#linkProp')
    ok(pg.input_value('#linkProp') == 'https://rovyacreative.com.br/proposta#' + 'ab' * 16, 'proposta enviada mostra o link de aceite')
    ok(pg.evaluate("[...document.querySelectorAll('[data-st]')].map(b => b.dataset.st).join()") == 'aprovada,recusada', 'enviada: só aprovar ou recusar')
    ok('wa.me' in pg.get_attribute('a:has-text("WhatsApp")', 'href'), 'botão de WhatsApp com o link')
    pg.evaluate("() => { Object.assign(window.__D.crm_propostas[0], { status: 'aprovada', aceite_em: '2026-11-21T15:00:00Z', aceite_nome: 'Carla Dias', aceite_ip: '1.2.3.4' }); location.hash = '#/propostas'; }")
    pg.wait_for_selector('#nProp'); pg.evaluate("location.hash = '#/proposta/pp3'"); pg.wait_for_selector('#st')
    ok('Aceita online por Carla Dias' in pg.inner_text('#main') and pg.locator('[data-st]').count() == 0 and pg.locator('#linkProp').count() == 0, 'aceita online: mostra quem aceitou e não oferece mudar status')
    pg.evaluate("() => { Object.assign(window.__D.crm_propostas[0], { status: 'rascunho', aceite_em: null }); location.hash = '#/propostas'; }")
    pg.wait_for_selector('#nProp'); pg.evaluate("location.hash = '#/proposta/pp3'"); pg.wait_for_selector('#st')
    ok(pg.evaluate("[...document.querySelectorAll('[data-st]')].map(b => b.dataset.st).join()") == 'enviada', 'rascunho: só marcar enviada (não aprova direto)')

    # 5) página pública da proposta (site/proposta.html) com a função de mentira
    PROP = {'titulo': 'Gestão de redes', 'versao': 2, 'corpo': '## Escopo\n12 posts por mês', 'itens': [{'nome': 'Social media', 'descricao': 'Plano mensal', 'qtd': 3, 'preco': 1500}],
            'desconto': 500, 'valor': 4000, 'validade': '2026-12-01', 'status': 'enviada', 'enviada_em': '2026-11-20', 'aceite_em': None, 'aceite_nome': None, 'vencida': False, 'atualizada': False,
            'cliente': {'nome': 'Carla Dias', 'empresa': 'Clínica Dias'}}
    chamadas = []
    def funcao(route):
        bd = json.loads(route.request.post_data); chamadas.append(bd)
        if bd['acao'] == 'ver': return route.fulfill(json=PROP)
        if len(bd.get('nome', '')) < 3: return route.fulfill(status=400, json={'erro': 'Escreva seu nome completo.'})
        route.fulfill(json={'ok': True, 'aceite_em': '2026-11-22T13:05:00Z', 'aceite_nome': bd['nome']})
    pp = b.new_page(viewport={'width': 390, 'height': 844})
    pp.on('pageerror', lambda e: erros.append('pageerror proposta ' + str(e)))
    pp.route('**/functions/v1/crm-proposta', funcao); pp.route('https://fonts.**', lambda r: r.abort())
    site = pathlib.Path(__file__).resolve().parents[2] / 'site' / 'proposta.html'
    pp.goto(site.as_uri() + '#' + 'cd' * 16); pp.wait_for_selector('#fAceite')
    t = pp.inner_text('main').replace(' ', ' ')
    ok('Gestão de redes' in t and 'Clínica Dias' in t and 'R$ 4.000,00' in t and 'Desconto' in t and 'Escopo' in t, 'mostra título, cliente, itens, desconto, total e texto')
    ok(chamadas[0] == {'token': 'cd' * 16, 'acao': 'ver'}, 'pede a proposta pelo link')
    ok(pp.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'cabe no celular sem rolar para o lado')
    pp.fill('#fAceite [name=nome]', 'Carla Dias'); pp.click('#fAceite button')
    ok(pp.locator('#fAceite').count() == 1 and chamadas[-1]['acao'] == 'ver', 'sem marcar "li e aceito" não envia')
    pp.check('#fAceite input[type=checkbox]'); pp.click('#fAceite button'); pp.wait_for_selector('.aceita')
    ok(chamadas[-1] == {'token': 'cd' * 16, 'acao': 'aceitar', 'nome': 'Carla Dias'} and 'aceita por Carla Dias' in pp.inner_text('.aceita'), 'aceita e mostra a confirmação')
    PROP.update(vencida=True); pp.reload(); pp.wait_for_selector('#aceite')
    ok(pp.locator('#fAceite').count() == 0 and 'venceu' in pp.inner_text('#aceite'), 'proposta vencida não oferece aceitar')
    PROP.update(vencida=False, atualizada=True); pp.reload(); pp.wait_for_selector('#aceite')
    ok(pp.locator('#fAceite').count() == 0 and 'versão nova' in pp.inner_text('#aceite'), 'versão antiga manda pedir o link novo')
    pp.goto('about:blank'); pp.goto(site.as_uri() + '#abc'); pp.wait_for_selector('.vazio')
    ok('Link incompleto' in pp.inner_text('main') and len(chamadas) == 4, 'link quebrado nem chama a função')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
