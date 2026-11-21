# Portal do cliente (site/portal.html) com login e função de mentira, e o cartão "Portal do cliente" na ficha do CRM.
import sys, os, json, copy
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
PORTAL = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'site', 'portal.html')
FALSO_SUPABASE = """const S = window.__S ||= {}; const g = () => sessionStorage.setItem('S', JSON.stringify(S)); // sobrevive ao recarregar, como o login de verdade
export const createClient = () => ({ auth: {
  getSession: async () => ({ data: { session: S.session || null } }),
  refreshSession: async () => ({ data: { session: S.session } }),
  signInWithPassword: async ({ email, password }) => password === 'certa'
    ? (S.session = { access_token: 'tk', expires_at: Date.now() / 1000 + 3600, user: { email, user_metadata: { trocar_senha: !!S.trocar } } }, g(), { error: null })
    : { error: { message: 'Invalid login credentials' } },
  updateUser: async ({ password, data }) => { S.nova = password; S.session.user.user_metadata = data; g(); return { error: null }; },
  signOut: async () => { S.session = null; g(); } } });"""
ent = lambda i, st, **k: {'id': 'x%d' % i, 'titulo': 'Entrega %d' % i, 'status': st, 'prazo': None, 'formato': None, **k}
BASE = {'cliente': {'nome': 'Paulo Mendes', 'empresa': 'Imobiliária Horizonte', 'estrategia': '## Posicionamento\nAlto padrão, **sem pressa**.'},
        'projetos': [{'id': 'p1', 'nome': 'Gestão de comunicação', 'status': 'ativo', 'entrega_prevista': '2026-12-20', 'etapas': [
            {'titulo': 'Diagnóstico', 'orientacao': 'Oi, Paulo! Nesta etapa…', 'entregas': [
                ent(1, 'enviado', titulo='Post de lançamento', texto='## Legenda\nTexto final', link='https://canva.com/x', anexos=[{'nome': 'post.png', 'url': 'data:image/png;base64,iVBORw0KGgo=', 'tamanho': 1000}, {'nome': 'Plano.pdf', 'url': 'https://assinada/plano.pdf', 'tamanho': 2097152}]),
                ent(2, 'enviado', titulo='Carrossel', texto='Slides', link='javascript:alert(1)', anexos=[]),
                ent(3, 'aprovado', texto='ok', link=None, anexos=[]),
                ent(4, 'produzindo', prazo='2026-12-01')]},
            {'titulo': 'Guia de Publicação', 'consulta': True, 'orientacao': None, 'entregas': [
                ent(5, 'aprovado', titulo='Como usar', texto='## Passo 1\n---\nLeia com calma', link=None, anexos=[]), ent(6, 'a_fazer', titulo='Guia')]}]}],
        'pedidos': [{'titulo': 'Ajuste pedido pelo cliente: Banner', 'descricao': 'Trocar cor', 'status': 'fazendo', 'criado_em': '2026-11-20T10:00:00Z'}]}
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    D = copy.deepcopy(BASE); chamadas = []; estado = {'sem_acesso': False}
    def funcao(route):
        if route.request.method == 'OPTIONS': return route.fulfill(status=200, body='ok')
        c = json.loads(route.request.post_data); chamadas.append(c)
        if estado['sem_acesso']: return route.fulfill(status=403, json={'erro': 'Este login ainda não tem acesso ao portal. Fale com a Rovya.', 'sem_acesso': True})
        es = {x['id']: x for e in D['projetos'][0]['etapas'] for x in e['entregas']}
        if c['acao'] == 'aprovar': es[c['entrega_id']]['status'] = 'aprovado'
        if c['acao'] == 'alterar': es[c['entrega_id']]['status'] = 'revisao'
        if c['acao'] == 'pedir': D['pedidos'].insert(0, {'titulo': 'Pedido do cliente: ' + c['titulo'], 'descricao': c['descricao'], 'status': 'a_fazer', 'criado_em': '2026-11-21T10:00:00Z'})
        route.fulfill(json=D if c['acao'] == 'dados' else {'ok': True})
    pg.route('http://portal.local/portal', lambda r: r.fulfill(path=PORTAL, content_type='text/html; charset=utf-8'))
    pg.route('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm', lambda r: r.fulfill(body=FALSO_SUPABASE, content_type='text/javascript'))
    pg.route('https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-portal', funcao)
    pg.route('https://fonts.googleapis.com/**', lambda r: r.abort())
    pg.route('http://portal.local/img/**', lambda r: r.abort())
    pg.add_init_script("window.__S = JSON.parse(sessionStorage.getItem('S') || '{\"trocar\": true}')")

    pg.goto('http://portal.local/portal'); pg.wait_for_selector('#vEntrar:not([hidden])')
    ok(pg.locator('#sair').is_hidden(), 'antes de entrar: tela de login, sem botão Sair')
    pg.fill('#fEntrar [name=email]', 'paulo@x.com'); pg.fill('#fEntrar [name=senha]', 'errada'); pg.click('#fEntrar button')
    pg.wait_for_selector('#mEntrar:not(:empty)'); ok(pg.inner_text('#mEntrar') == 'E-mail ou senha não conferem.', 'senha errada: mensagem em português')
    pg.fill('#fEntrar [name=senha]', 'certa'); pg.click('#fEntrar button'); pg.wait_for_selector('#vSenha:not([hidden])')
    ok(pg.locator('#cancelaSenha').is_hidden(), 'primeiro acesso: pede a senha nova antes de mostrar o portal (sem "Voltar")')
    pg.fill('#fSenha [name=nova]', 'minhaSenha1'); pg.fill('#fSenha [name=repete]', 'outraSenha1'); pg.click('#fSenha button >> nth=0')
    ok('não são iguais' in pg.inner_text('#mSenha'), 'senhas diferentes: avisa')
    pg.fill('#fSenha [name=repete]', 'minhaSenha1'); pg.click('#fSenha button >> nth=0'); pg.wait_for_selector('#vPortal:not([hidden])')
    ok(pg.evaluate('window.__S.nova') == 'minhaSenha1' and pg.evaluate('window.__S.session.user.user_metadata.trocar_senha') is False, 'salva a senha e desliga o "trocar senha"')

    # para aprovar
    ok('Paulo' in pg.inner_text('#ola') and pg.text_content('#empresa') == 'Imobiliária Horizonte', 'saudação com nome e empresa')
    ok(pg.locator('.abas .on').get_attribute('data-a') == 'aprovar' and pg.inner_text('.abas [data-a=aprovar] b') == '2', 'abre em "Para aprovar" com 2 pendentes')
    card = pg.locator('#aba article').first
    ok(card.locator('b.tit').inner_text() == 'Legenda' and card.locator('.imgs img').count() == 1 and card.locator('.arqs a').inner_text() == 'Plano.pdf', 'mostra texto, imagem e arquivo da entrega')
    ok(card.locator('a.btn').get_attribute('href') == 'https://canva.com/x' and pg.locator('#aba article').nth(1).locator('a.btn').count() == 0, 'link https vira botão; link javascript: é ignorado')
    pg.screenshot(path='testes/saida/portal_aprovar.png', full_page=True)
    card.locator('[data-aprovar]').click(); pg.wait_for_function("document.querySelectorAll('#aba article').length === 1")
    ok(chamadas[-2] == {'acao': 'aprovar', 'entrega_id': 'x1'}, 'aprovar manda a entrega certa')
    pg.click('#aba [data-alterar]'); pg.fill('#aba form.alterar textarea', 'Trocar a foto'); pg.click('#aba form.alterar button')
    pg.wait_for_selector('#aba .vazio')
    ok({'acao': 'alterar', 'entrega_id': 'x2', 'comentario': 'Trocar a foto'} in chamadas, 'pedir alteração manda o comentário')
    ok(pg.locator('.abas [data-a=aprovar] b').count() == 0, 'sem pendentes: some o contador')

    # planejamento, arquivos, estratégia
    pg.click('.abas [data-a=planejamento]')
    plano = pg.inner_text('#aba')
    ok('Gestão de comunicação' in plano and '2 de 4 aprovadas' in plano and 'Em ajuste' in plano and 'ter, 01/12' in plano, 'quadro: progresso (sem contar a consulta), status e dia')
    ok(pg.locator('#aba .coluna').count() == 2 and pg.locator('#aba .cartao').count() == 6, 'uma coluna por etapa, um cartão por entrega')
    ok(pg.inner_text('.cartao[data-cartao=x5] .pill') == 'Para ler' and pg.inner_text('.cartao[data-cartao=x6] .pill') == 'Em preparação', 'cartões só consulta: "Para ler" ou "Em preparação"')
    pg.click('#aba details.ori summary'); ok(pg.locator('#aba details.ori .txt').inner_text().startswith('Oi, Paulo'), 'orientação da etapa')
    pg.click('.cartao[data-cartao=x4]'); pg.wait_for_selector('#dlgCartao[open]')
    ok('Em produção' in pg.inner_text('#dlgCorpo') and 'Data: 01/12/2026 — Terça-feira' in pg.inner_text('#dlgCorpo'), 'cartão em produção: data por extenso e sem conteúdo')
    pg.click('#dlgCartao .fechar'); pg.wait_for_selector('#dlgCartao[open]', state='detached')
    pg.click('.cartao[data-cartao=x5]'); pg.wait_for_selector('#dlgCartao[open]')
    ok(pg.locator('#dlgCorpo hr').count() == 1 and pg.locator('#dlgCorpo [data-aprovar]').count() == 0, 'consulta: texto com linha divisória e sem botão de aprovar')
    pg.keyboard.press('Escape'); pg.wait_for_selector('#dlgCartao[open]', state='detached')
    pg.screenshot(path='testes/saida/portal_planejamento.png', full_page=True)
    D['projetos'][0]['etapas'][0]['entregas'][1]['status'] = 'enviado'  # a Sabrina reenviou o carrossel
    pg.reload(); pg.wait_for_selector('#vPortal:not([hidden])'); pg.wait_for_selector('.cartao[data-cartao=x2].enviado')
    pg.click('.cartao[data-cartao=x2]'); pg.wait_for_selector('#dlgCorpo [data-aprovar]')
    pg.screenshot(path='testes/saida/portal_cartao.png')
    pg.click('#dlgCorpo [data-aprovar]'); pg.wait_for_selector('#dlgCartao[open]', state='detached')
    ok(chamadas[-2] == {'acao': 'aprovar', 'entrega_id': 'x2'} and pg.inner_text('.cartao[data-cartao=x2] .pill') == '✓ Aprovado', 'aprovar pelo cartão aberto: fecha e atualiza o quadro')
    pg.click('.abas [data-a=arquivos]'); arq = pg.inner_text('#aba')
    ok('Plano.pdf' in arq and '2.0 MB' in arq and 'post.png' in arq, 'arquivos para baixar com tamanho')
    pg.click('.abas [data-a=estrategia]'); ok(pg.inner_text('#aba b.tit') == 'Posicionamento' and pg.locator('#aba .txt b:not(.tit)').inner_text() == 'sem pressa', 'estratégia formatada')

    # solicitações
    pg.click('.abas [data-a=solicitacoes]')
    ok('Ajuste: Banner' in pg.inner_text('#aba') and 'Em andamento' in pg.inner_text('#aba'), 'lista as solicitações com status')
    pg.fill('#fPedido [name=titulo]', 'Post Dia das Mães'); pg.fill('#fPedido [name=descricao]', 'Até sexta'); pg.click('#fPedido button')
    pg.wait_for_function("document.querySelector('#aba').innerText.includes('Post Dia das Mães')")
    ok({'acao': 'pedir', 'titulo': 'Post Dia das Mães', 'descricao': 'Até sexta'} in chamadas and 'Recebido' in pg.inner_text('#aba'), 'nova solicitação enviada e listada')

    # celular, recarregar mantendo a aba, sair, sem acesso
    pg.set_viewport_size({'width': 390, 'height': 800}); pg.reload(); pg.wait_for_selector('#vPortal:not([hidden])')
    ok(pg.locator('.abas .on').get_attribute('data-a') == 'solicitacoes', 'recarregar volta na mesma aba')
    ok(pg.evaluate('document.documentElement.scrollWidth') <= 390, 'celular: sem rolagem para o lado')
    pg.screenshot(path='testes/saida/portal_celular.png', full_page=True)
    pg.click('#sair'); pg.wait_for_selector('#vEntrar:not([hidden])'); ok(True, 'sair volta para o login')
    estado['sem_acesso'] = True; pg.evaluate('window.__S.trocar = false'); pg.fill('#fEntrar [name=email]', 'paulo@x.com'); pg.fill('#fEntrar [name=senha]', 'certa'); pg.click('#fEntrar button')
    pg.wait_for_selector('#mEntrar:not(:empty)'); ok('não tem acesso' in pg.inner_text('#mEntrar') and pg.evaluate('window.__S.session') is None, 'login sem vínculo: avisa e desloga')

    # CRM: cartão na ficha do cliente
    crm = b.new_page(viewport={'width': 1300, 'height': 900})
    crm.on('pageerror', lambda e: erros.append('crm pageerror ' + str(e)))
    crm.goto('http://localhost:8777/_mock.html#/clientes'); crm.wait_for_selector('tr[data-id]')
    crm.evaluate("""() => { window.__D.crm_portal = [{ user_id: 'u1', cliente_id: 'c1', email: 'paulo@horizonte.com', ultimo_acesso: '2026-11-20T15:00:00Z' }]; window.__pt = [];
      const f = window.fetch; window.fetch = (u, o) => { if (!String(u).includes('crm-portal')) return f(u, o); const b = JSON.parse(o.body); window.__pt.push(b);
        return Promise.resolve(new Response(JSON.stringify(b.acao === 'convidar' ? { ok: true, user_id: 'u9', senha: 'abcd-efgh-jkmn' } : { ok: true, senha: 'nova-senh-a234' }))); };
      location.hash = '#/cliente/c1'; }""")
    crm.wait_for_selector('#cartaoPortal')
    cart = crm.inner_text('#cartaoPortal')
    ok('paulo@horizonte.com' in cart and 'Último acesso: 20 de nov. de 2026' in cart and 'ainda não escrita' in cart, 'cartão mostra quem tem acesso e o último acesso')
    crm.click('#portalDar'); crm.wait_for_selector('#dlg[open]')
    ok(crm.input_value('#dlgf [name=email]') == 'paulo@horizonte.com', 'e-mail do cliente já preenchido')
    crm.fill('#dlgf [name=email]', 'Socio@Horizonte.com'); crm.click('#dlgf button[value=ok]')
    crm.wait_for_function("document.querySelector('#dlgf h2')?.innerText === 'Acesso pronto'")
    msg = crm.input_value('#dlgf [name=msg]')
    ok(crm.evaluate('window.__pt[0]') == {'acao': 'convidar', 'cliente_id': 'c1', 'email': 'Socio@Horizonte.com'}, 'convida para o cliente certo')
    ok('abcd-efgh-jkmn' in msg and 'https://rovyacreative.com.br/portal' in msg and 'socio@horizonte.com' in msg and msg.startswith('Olá, Paulo!'), 'mensagem pronta com link, e-mail e senha provisória')
    ok('wa.me/5516999990000?text=' in (crm.locator('#dlgf a[href*="wa.me"]').get_attribute('href') or ''), 'botão para mandar pelo WhatsApp')
    crm.screenshot(path='testes/saida/portal_crm_acesso.png')
    crm.click('#dlgf button[value=ok]'); crm.wait_for_selector('#cartaoPortal')
    crm.click('[data-portal-senha="u1"]'); crm.wait_for_selector('#dlg[open]'); crm.click('#dlgf button[value=ok]')
    crm.wait_for_function("document.querySelector('#dlgf h2')?.innerText === 'Acesso pronto'")
    ok(crm.evaluate('window.__pt[1]') == {'acao': 'nova_senha', 'user_id': 'u1'} and 'nova-senh-a234' in crm.input_value('#dlgf [name=msg]'), 'nova senha com confirmação')
    crm.click('#dlgf button[value=cancelar]')
    crm.click('#portalEstrategia'); crm.wait_for_selector('#dlg[open]'); crm.fill('#dlgf [name=estrategia]', '## Tom de voz\nPróximo'); crm.click('#dlgf button[value=ok]'); crm.wait_for_timeout(300)
    ok(crm.evaluate("window.__log.some(([t, k, a]) => t === 'crm_clientes' && k === 'update' && a[0].estrategia === '## Tom de voz\\nPróximo')"), 'grava a estratégia no cliente')
    crm.click('[data-portal-tirar="u1"]'); crm.wait_for_selector('#dlg[open]'); crm.click('#dlgf button[value=ok]'); crm.wait_for_timeout(300)
    ok(crm.evaluate('window.__pt[2]') == {'acao': 'remover', 'user_id': 'u1'}, 'remover pede confirmação e tira o acesso')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
