# "Mês de conteúdo" (quadro como o Trello da Sabrina), etapa "só consulta" e importação de quadro do Trello (Trello de mentira).
import sys, json
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
U = 'http://localhost:8777/_mock.html'
ID = lambda ch: ch * 24
QUADRO = {'nome': 'Optimer Contabilidade', 'listas': [
    {'id': 'l1', 'nome': 'Planejamento Estratégico — Novembro 2026', 'cartoes': [
        {'id': ID('a'), 'nome': 'Planejamento Estratégico', 'desc': '## Plano\n---\nTexto', 'due': None, 'feito': False, 'checklists': [],
         'anexos': [{'id': ID('b'), 'nome': 'plano.pdf', 'bytes': 2048, 'upload': True, 'url': 'x'}]}]},
    {'id': 'l2', 'nome': 'Semana 01 | 02 a 08 de novembro', 'cartoes': [
        {'id': ID('c'), 'nome': 'Publicar em 03/11', 'desc': '**Data:** 03/11', 'due': '2026-11-03T15:00:00.000Z', 'feito': True,
         'anexos': [{'id': ID('d'), 'nome': 'arte 1.png', 'bytes': 4096, 'upload': True, 'url': 'x'}, {'id': ID('f'), 'nome': 'Canva', 'upload': False, 'url': 'https://canva.com/x'}],
         'checklists': [{'nome': 'Checklist', 'itens': [{'nome': 'Revisar', 'feito': True}, {'nome': 'Postar', 'feito': False}]}]},
        {'id': ID('e'), 'nome': 'Publicar em 05/11', 'desc': '', 'due': None, 'feito': False, 'anexos': [], 'checklists': []}]},
    {'id': 'l3', 'nome': 'Arquivo morto', 'cartoes': [{'id': ID('9'), 'nome': 'Velho', 'desc': '', 'due': None, 'feito': False, 'anexos': [], 'checklists': []}]}]}
FALSO_TRELLO = """() => { window.__tr = []; window.__trConf = false; const f = window.fetch;
  window.fetch = (u, o) => { if (!String(u).includes('crm-trello')) return f(u, o); const b = JSON.parse(o.body); window.__tr.push(b);
    const r = b.acao === 'config' ? { configurado: window.__trConf } : b.acao === 'salvar' ? (window.__trConf = true, { ok: true, nome: 'Sabrina Amorim' })
      : b.acao === 'quadro' ? %s : { ok: true, tamanho: b.anexo === '%s' ? 2048 : 4096 };
    return Promise.resolve(new Response(JSON.stringify(r))); }; }""" % (json.dumps(QUADRO, ensure_ascii=False), ID('b'))
rpcs = lambda pg: pg.evaluate("window.__log.filter(([t, n]) => t === 'rpc' && n === 'crm_projeto_de_modelo').map(x => x[2][0])")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))

    # 1) Mês de conteúdo
    pg.goto(U + '#/cliente/c1'); pg.wait_for_selector('#nProj')
    pg.click('#nProj'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=modelo] option[value=mes]').count() == 1, '"Mês de conteúdo" aparece em Começar a partir de')
    pg.select_option('#dlgf [name=modelo]', 'mes'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_selector('#dlgf [name=mes]'); pg.fill('#dlgf [name=mes]', '2026-11'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    a = rpcs(pg)[-1]; e = a['p_estrutura']; t = [x['titulo'] for x in e]
    ok(a['p_nome'] == 'Imobiliária Horizonte · Novembro 2026' and a['p_modelo'] is None, 'projeto com o mês no nome: ' + a['p_nome'])
    ok(t == ['Planejamento Estratégico — Novembro 2026', 'Semana 01 | 02 a 08 de novembro', 'Semana 02 | 09 a 15 de novembro', 'Semana 03 | 16 a 22 de novembro',
             'Semana 04 | 23 a 29 de novembro', 'Semana 05 | 30 de novembro', 'Radar e Oportunidades', 'Guia de Publicação'], 'colunas do mês: ' + ' / '.join(t))
    ok([x.get('consulta', False) for x in e] == [True, False, False, False, False, False, True, True], 'planejamento, radar e guia são só consulta; semanas o cliente aprova')
    s1 = e[1]['entregas']
    ok([x['titulo'] for x in s1] == ['Publicar em 02/11', 'Publicar em 04/11', 'Publicar em 06/11'] and s1[0]['prazo'] == '2026-11-02', 'posts de segunda, quarta e sexta com data')
    ok(s1[0]['texto'].startswith('## IMOBILIÁRIA HORIZONTE | PRODUÇÃO DE CONTEÚDO\n**Data:** 02/11/2026 — Segunda-feira\n**Formato:** \n**Tema:** ') and '{{contato}}, ' in s1[0]['texto'],
       'cartão no formato do Trello dela (Data, Formato, Tema, Sobre o conteúdo)')

    # 2) etapa só consulta no projeto
    pg.evaluate("() => { window.__D.crm_projetos[0].crm_etapas[0].consulta = true; location.hash = '#/clientes'; }"); pg.wait_for_selector('tr[data-id]')
    pg.evaluate("location.hash = '#/projeto/pr1'")  # o Mês de conteúdo já deixou a tela no projeto: sai e volta para redesenhar
    pg.wait_for_selector('[data-ed-etapa]')
    ok(pg.locator('.etapa', has_text='SÓ CONSULTA').count() == 1, 'projeto mostra a etapa só consulta')
    pg.click('[data-ed-etapa] >> nth=1'); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#dlgf [name=consulta]', '1'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__log.some(([t, k, a]) => t === 'crm_etapas' && k === 'update' && a[0].consulta === true)"), 'editar etapa: marca como só consulta')

    # 3) importar do Trello
    pg.goto(U + '#/cliente/c1'); pg.wait_for_selector('#impTrello')
    pg.evaluate(FALSO_TRELLO)
    pg.evaluate("() => { window.__D.crm_etapas = [{ ordem: 2, crm_entregas: [{ id: 'E3', ordem: 2 }, { id: 'E2', ordem: 1 }] }, { ordem: 1, crm_entregas: [{ id: 'E1', ordem: 1 }] }]; }")
    pg.click('#impTrello'); pg.wait_for_selector('#dlgf [name=token]')
    ok('power-ups/admin' in pg.inner_html('#dlgf'), 'primeira vez: explica como pegar a chave e o token')
    pg.fill('#dlgf [name=key]', '0' * 32); pg.fill('#dlgf [name=token]', 'ATTA' + 'x' * 60); pg.click('#dlgf button[value=ok]')
    pg.wait_for_selector('#dlgf [name=link]'); pg.fill('#dlgf [name=link]', 'https://trello.com/b/AbCd1234/optimer'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_selector('#dlgf [data-lista]')
    ok([pg.input_value(f'#dlgf [data-lista="{i}"]') for i in range(3)] == ['consulta', 'aprova', 'consulta'], 'sugere: semanas o cliente aprova, o resto só consulta')
    ok('2 arquivo(s)' in pg.inner_text('#dlgf'), 'avisa quantos arquivos vêm do Trello')
    pg.screenshot(path='testes/saida/trello_importar.png')
    pg.select_option('#dlgf [data-lista="2"]', 'fora'); pg.select_option('#dlgf [name=status]', 'enviado'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_function("location.hash === '#/projeto/pr1'", timeout=10000)
    tr = pg.evaluate('window.__tr')
    ok([x['acao'] for x in tr] == ['config', 'salvar', 'quadro', 'anexo', 'anexo'] and tr[2]['link'] == 'https://trello.com/b/AbCd1234/optimer', 'conecta, lê o quadro e copia os 2 arquivos: ' + str([x['acao'] for x in tr]))
    a = rpcs(pg)[-1]; e = a['p_estrutura']
    ok(a['p_nome'] == 'Optimer Contabilidade' and a['p_cliente'] == 'c1' and [x['titulo'] for x in e] == ['Planejamento Estratégico — Novembro 2026', 'Semana 01 | 02 a 08 de novembro'], 'cria o projeto sem a coluna deixada de fora')
    ok(e[0]['consulta'] is True and e[1]['consulta'] is False, 'só consulta conforme escolhido')
    c1, c2 = e[1]['entregas']
    ok(c1['status'] == 'aprovado' and c2['status'] == 'enviado' and c1['prazo'] == '2026-11-03' and c2['prazo'] is None, 'cartão concluído no Trello entra aprovado; os outros como escolhido; data do vencimento')
    ok('☑ Revisar' in c1['texto'] and '☐ Postar' in c1['texto'] and 'Link: Canva — https://canva.com/x' in c1['texto'] and c1['texto'].startswith('**Data:** 03/11') and c2['texto'] is None,
       'descrição + checklist + links no texto do cartão')
    an = [x for x in tr if x['acao'] == 'anexo']
    ok(an[0]['card'] == ID('a') and an[0]['caminho'].startswith('pr1/E1/') and an[0]['caminho'].endswith('-plano.pdf') and an[1]['caminho'].startswith('pr1/E2/') and an[1]['caminho'].endswith('-arte_1.png'),
       'cada arquivo vai para a entrega certa: ' + an[0]['caminho'] + ' | ' + an[1]['caminho'])
    ins = pg.evaluate("window.__log.filter(([t, k]) => t === 'crm_anexos' && k === 'insert').map(x => x[2][0])")
    ok(len(ins) == 2 and ins[0]['entrega_id'] == 'E1' and ins[0]['tamanho'] == 2048 and ins[1]['nome'] == 'arte 1.png', 'registra os anexos no CRM')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
