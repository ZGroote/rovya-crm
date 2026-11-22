# Teste integrado: Supabase temporário (subido pelo GitHub Actions) + CRM + site + portal, com login de verdade.
# Nunca toca produção:
#   - para logo no início se achar endereço ou credencial de produção no ambiente;
#   - as migrações rodam com o endereço de produção trocado por um endereço morto, e as rotinas automáticas são desligadas;
#   - CRM e site rodam de cópias em que o endereço/chave de produção foram trocados pelos locais (e a cópia é conferida);
#   - o navegador bloqueia qualquer pedido a produção e o teste falha se algum acontecer;
#   - a crm-assistente é trocada por um capturador (avisos vão para a tabela teste_avisos, nada sai).
# Uso (no workflow): supabase start → functions serve → python testes/integrado/rodar_integrado.py
import os, sys, json, re, shutil, subprocess, threading, datetime, pathlib, functools, traceback, concurrent.futures
import http.server as servidor_http
import urllib.request, urllib.error, urllib.parse

RAIZ = pathlib.Path(__file__).resolve().parents[2]
SITE = pathlib.Path(os.environ.get('SITE_DIR', RAIZ / '_site'))
SAIDA = RAIZ / 'relatorio'
PROD_REF = 'jgigosrsyxjqqhckudfe'
PROD_URL = f'https://{PROD_REF}.supabase.co'
PROD_CHAVE = 'sb_publishable_Y7tQfUBPShG6MIeAEChc5Q_3k2wOB0W'
URL_MORTA = 'http://127.0.0.1:9/bloqueado-no-teste'
HOJE = datetime.date.today()
dia = lambda n: (HOJE + datetime.timedelta(days=n)).isoformat()
MES = HOJE.strftime('%Y-%m')

resultados, falhas_browser, bloqueados = [], [], []
def ok(id_, cenario, cond, evid=''):
    resultados.append({'id': id_, 'cenario': cenario, 'ok': bool(cond), 'evidencia': str(evid)[:400]})
    print(('OK   ' if cond else 'FALHA'), id_, cenario, '|', str(evid)[:200], flush=True)
    return bool(cond)
def etapa(id_, cenario):
    """decorador: roda o bloco; exceção vira FALHA registrada e o teste segue para o próximo bloco"""
    def dec(f):
        try: return f()
        except Exception as e:
            ok(id_, cenario + ' (erro ao executar)', False, f'{type(e).__name__}: {e} | ' + traceback.format_exc().splitlines()[-3])
    return dec

# ---------- 0) trava de segurança ----------
for k, v in os.environ.items():
    if PROD_REF in v or k in ('SUPABASE_ACCESS_TOKEN', 'SUPABASE_DB_PASSWORD', 'SUPABASE_PROJECT_ID'):
        sys.exit(f'PARADO: variável de produção no ambiente ({k}). O teste integrado só roda no Supabase temporário.')

st = {}
for linha in subprocess.run(['supabase', 'status', '-o', 'env'], cwd=RAIZ, capture_output=True, text=True, check=True).stdout.splitlines():
    m = re.match(r'^([A-Z_]+)="?(.*?)"?$', linha.strip())
    if m: st[m[1]] = m[2]
API, DB = st['API_URL'].rstrip('/'), st['DB_URL']
ANON, SR = st.get('ANON_KEY') or st['PUBLISHABLE_KEY'], st.get('SERVICE_ROLE_KEY') or st['SECRET_KEY']
if not re.match(r'^http://(127\.0\.0\.1|localhost):', API) or not re.search(r'@(127\.0\.0\.1|localhost):', DB):
    sys.exit(f'PARADO: o Supabase não é local ({API}).')
print('Supabase local:', API, flush=True)

def psql(sql=None, arquivo=None):
    cmd = ['psql', DB, '-v', 'ON_ERROR_STOP=1', '-q', '-At'] + (['-f', str(arquivo)] if arquivo else ['-c', sql])
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: raise RuntimeError(f'psql falhou ({arquivo or sql[:60]}): {r.stderr.strip()[:800]}')
    return r.stdout.strip()

# ---------- 1) banco: preparo + migrações 001..024, sem nada apontando para produção ----------
def montar_banco():
    psql(arquivo=RAIZ / 'testes/integrado/preparo.sql')
    tmp = RAIZ / 'relatorio/_migracoes'; tmp.mkdir(parents=True, exist_ok=True)
    feitas = []
    for f in sorted((RAIZ / 'supabase').glob('0*.sql')):
        if f.name == '002_seed.sql': continue  # textos do método da Sabrina: fora do git de propósito
        t = f.read_text(encoding='utf-8').replace(PROD_URL, URL_MORTA)
        if PROD_REF in t: sys.exit(f'PARADO: {f.name} ainda cita produção depois da troca.')
        (tmp / f.name).write_text(t, encoding='utf-8'); psql(arquivo=tmp / f.name); feitas.append(f.name)
    psql("select cron.unschedule(jobid) from cron.job")  # rotinas automáticas desligadas no banco de teste
    psql("notify pgrst, 'reload schema'"); import time; time.sleep(3)  # a API do banco passa a enxergar as tabelas novas
    sobra = psql(f"select count(*) from cron.job") + '/' + psql(f"select count(*) from pg_proc where prosrc like '%{PROD_REF}%'")
    return feitas, sobra
feitas, sobra = montar_banco()
ok('INF-01', 'Migrações 001–024 aplicadas no banco temporário (002_seed fica fora do git)', feitas[-1] == '024_fluxo.sql' and '001_crm.sql' in feitas, ', '.join(feitas))
ok('INF-02', 'Nenhuma rotina automática ligada e nenhuma função do banco citando produção', sobra == '0/0', 'rotinas/funções com produção: ' + sobra)

# ---------- 2) HTTP ----------
def http(metodo, url, corpo=None, token=None, chave=ANON, extra=None):
    assert PROD_REF not in url, 'pedido a produção bloqueado: ' + url
    h = {'Content-Type': 'application/json', **({'apikey': chave} if chave else {}), **({'Authorization': 'Bearer ' + token} if token else {}), **(extra or {})}
    req = urllib.request.Request(url, data=None if corpo is None else json.dumps(corpo).encode(), method=metodo, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=90) as r: b = r.read(); return r.status, (json.loads(b) if b else None)
    except urllib.error.HTTPError as e:
        b = e.read()
        try: return e.code, json.loads(b)
        except Exception: return e.code, b.decode(errors='replace')
def rest(metodo, caminho, corpo=None, token=None, chave=ANON):
    return http(metodo, f'{API}/rest/v1/{caminho}', corpo, token or chave, chave, {'Prefer': 'return=representation'})
def adm_sr(metodo, caminho, corpo=None):  # service role: só para CONFERIR o banco (as ações passam pelas telas e funções)
    return rest(metodo, caminho, corpo, SR, SR)
def um(caminho):
    s, j = adm_sr('GET', caminho); assert s == 200, (s, j); return j[0] if j else None
def fn(nome, corpo, token=None, chave=ANON):
    return http('POST', f'{API}/functions/v1/{nome}', corpo, token, chave)
def criar_usuario(email, senha):
    s, j = http('POST', f'{API}/auth/v1/admin/users', {'email': email, 'password': senha, 'email_confirm': True}, SR, SR); assert s in (200, 201), (s, j); return j['id']
def entrar(email, senha):
    s, j = http('POST', f'{API}/auth/v1/token?grant_type=password', {'email': email, 'password': senha}); assert s == 200, (s, j); return j['access_token']
def criar(tabela, linha, token):
    s, j = rest('POST', tabela, linha, token); assert s == 201, (tabela, s, j); return j[0]
def decidir(pid, status, motivo=None, token=None):
    return rest('POST', 'rpc/crm_proposta_decidir', {'p_proposta': pid, 'p_status': status, 'p_motivo': motivo}, token or TA)
def avisos(titulo_parte):
    s, j = adm_sr('GET', 'teste_avisos?select=titulo'); return [a['titulo'] for a in j if titulo_parte in a['titulo']]

# ---------- 3) cópias de teste do CRM e do site, apontando para o Supabase local ----------
def copia(origem, destino):
    shutil.rmtree(destino, ignore_errors=True)
    shutil.copytree(origem, destino, ignore=shutil.ignore_patterns('.git', '.github', 'testes', 'supabase', '_site', 'relatorio', '*.mp4', '*.webm'))
    for p in destino.rglob('*'):
        if p.suffix in ('.html', '.js', '.css', '.webmanifest', '.json'):
            t = p.read_text(encoding='utf-8', errors='ignore')
            if PROD_REF in t or PROD_CHAVE in t: p.write_text(t.replace(PROD_URL, API).replace(PROD_CHAVE, ANON).replace(f'sb-{PROD_REF}-', 'sb-127-'), encoding='utf-8')  # nome da chave de login no navegador
    sobra = [p.name for p in destino.rglob('*') if p.suffix in ('.html', '.js') and PROD_REF in p.read_text(encoding='utf-8', errors='ignore')]
    if sobra: sys.exit('PARADO: endereço de produção na cópia de teste: ' + ', '.join(sobra))
def servir(pasta, porta):
    h = functools.partial(servidor_http.SimpleHTTPRequestHandler, directory=str(pasta)); h.log_message = lambda *a: None
    s = servidor_http.ThreadingHTTPServer(('127.0.0.1', porta), h); threading.Thread(target=s.serve_forever, daemon=True).start()
COPIA_CRM, COPIA_SITE = SAIDA / '_crm', SAIDA / '_site'
copia(RAIZ, COPIA_CRM); copia(SITE, COPIA_SITE)
servir(COPIA_CRM, 8777); servir(COPIA_SITE, 8788)
CRM, WEB = 'http://localhost:8777', 'http://localhost:8788'
ok('INF-03', 'CRM e site de teste apontam só para o Supabase local', True, f'{CRM} e {WEB} → {API}')

def commit(pasta):
    try: return subprocess.run(['git', 'rev-parse', '--short', 'HEAD'], cwd=pasta, capture_output=True, text=True).stdout.strip()
    except Exception: return '?'
COMMITS = {'crm': commit(RAIZ), 'site': commit(SITE)}

# ---------- 4) dados fictícios: admin, clientes A e B ----------
ADM, SENHA_ADM = 'admin@teste-rovya.dev', 'Teste-Admin-2026!'
criar_usuario(ADM, SENHA_ADM); psql(f"insert into public.admins(email) values ('{ADM}')")
TA = entrar(ADM, SENHA_ADM)
cliA = criar('crm_clientes', {'nome': 'Ana Teste', 'empresa': 'Empresa A', 'email': 'ana@cliente-a.dev', 'telefone': '(16) 90000-0001'}, TA)
cliB = criar('crm_clientes', {'nome': 'Bruno Teste', 'empresa': 'Empresa B', 'email': 'bruno@cliente-b.dev'}, TA)
ok('INF-04', 'Admin fictício entra com login de verdade e cadastra os clientes A e B (RLS de admin)', cliA['id'] and cliB['id'], f"A={cliA['id'][:8]} B={cliB['id'][:8]}")

from playwright.sync_api import sync_playwright
pw = sync_playwright().start()
nav = pw.chromium.launch()
ctx = nav.new_context(viewport={'width': 1280, 'height': 900}, locale='pt-BR', timezone_id='America/Sao_Paulo')
def barra_producao(rota):
    bloqueados.append(rota.request.url); rota.abort()
ctx.route(re.compile(PROD_REF), barra_producao)
def nova_pagina():
    p = ctx.new_page(); p.set_default_timeout(25000)
    p.on('pageerror', lambda e: falhas_browser.append(f'{p.url}: {e}')); return p
pg = nova_pagina()
def foto(nome, p=None): (p or pg).screenshot(path=str(SAIDA / f'{nome}.png'), full_page=False)
def inicio():
    pg.goto('about:blank'); pg.goto(CRM + '/app.html#/'); pg.wait_for_selector('#agHoje')
    pg.wait_for_timeout(300)
    return pg.inner_text('#cFluxo') if pg.locator('#cFluxo').count() else ''

# ---------- 5) ciclo completo: CRM → site → aceite → contrato pendente → projeto → portal ----------
@etapa('COM-00', 'Admin entra no CRM pela tela de login')
def _():
    pg.goto(CRM + '/login.html'); pg.fill('#email', ADM); pg.fill('#senha', SENHA_ADM); pg.press('#senha', 'Enter')
    pg.wait_for_url(re.compile(r'app\.html')); pg.wait_for_selector('#agHoje')
    ok('COM-00', 'Admin entra no CRM pela tela de login', True, pg.url)

ctx_c = {}
@etapa('COM-01', 'Enviar a proposta pelo CRM gera o link')
def _():
    op = criar('crm_oportunidades', {'cliente_id': cliA['id'], 'titulo': 'Gestão de redes', 'etapa': 'proposta', 'valor': 3000}, TA)
    pr = criar('crm_propostas', {'cliente_id': cliA['id'], 'oportunidade_id': op['id'], 'titulo': 'Gestão de redes', 'corpo': '## Escopo\n12 posts por mês',
               'itens': [{'nome': 'Social media', 'descricao': 'Plano mensal', 'qtd': 1, 'preco': 3000}], 'valor': 3000, 'validade': dia(15)}, TA)
    ctx_c.update(op=op, pr=pr)
    pg.goto(CRM + f"/app.html#/proposta/{pr['id']}"); pg.wait_for_selector('[data-st=enviada]')
    ok('CTR-P1', 'Proposta em rascunho só oferece "Marcar enviada"', pg.evaluate("[...document.querySelectorAll('[data-st]')].map(b => b.dataset.st).join()") == 'enviada')
    pg.click('[data-st=enviada]'); pg.wait_for_selector('#linkProp')
    link = pg.input_value('#linkProp'); ctx_c['token'] = link.split('#')[1]
    db = um(f"crm_propostas?id=eq.{pr['id']}&select=status,token,enviada_em")
    ok('COM-01', 'Marcar enviada no CRM gera o link de aceite', db['status'] == 'enviada' and db['token'] == ctx_c['token'] and len(db['token']) == 32, link)
    foto('01_crm_proposta_enviada')

@etapa('COM-02', 'Cliente aceita a proposta no site')
def _():
    p2 = nova_pagina(); p2.goto(WEB + '/proposta.html#' + ctx_c['token']); p2.wait_for_selector('#fAceite')
    ok('IDT-01', 'Página avisa que o aceite é comercial e a formalização vem pelo contrato', 'formalização será realizada posteriormente por meio de contrato assinado' in p2.inner_text('#aceite'))
    foto('02_site_proposta', p2)
    p2.fill('#fAceite [name=nome]', 'Ana Teste'); p2.check('#fAceite input[type=checkbox]'); p2.click('#fAceite button'); p2.wait_for_selector('.aceita')
    foto('03_site_aceita', p2)
    pr = um(f"crm_propostas?id=eq.{ctx_c['pr']['id']}&select=status,aceite_nome,aceite_em,aceite_ip")
    op = um(f"crm_oportunidades?id=eq.{ctx_c['op']['id']}&select=etapa,fechado_em")
    hist = adm_sr('GET', f"crm_interacoes?cliente_id=eq.{cliA['id']}&resumo=ilike.*aceita%20online*&select=id")[1]
    ok('COM-02', 'Aceite no site: proposta aprovada, nome/data/IP gravados, funil em Fechado, histórico e aviso',
       pr['status'] == 'aprovada' and pr['aceite_nome'] == 'Ana Teste' and pr['aceite_em'] and op['etapa'] == 'ganho' and op['fechado_em'] and len(hist) == 1 and len(avisos('Proposta aceita')) == 1,
       f"proposta={pr} funil={op['etapa']} histórico={len(hist)} avisos={avisos('Proposta aceita')}")
    p2.close()

@etapa('DUP-02', 'Aceitar a mesma proposta de novo')
def _():
    s, j = fn('crm-proposta', {'acao': 'aceitar', 'token': ctx_c['token'], 'nome': 'Outra Pessoa'}, chave=None)
    pr = um(f"crm_propostas?id=eq.{ctx_c['pr']['id']}&select=aceite_nome")
    hist = adm_sr('GET', f"crm_interacoes?cliente_id=eq.{cliA['id']}&resumo=ilike.*aceita%20online*&select=id")[1]
    ok('DUP-02', 'Segundo aceite: devolve o primeiro, sem novo histórico nem aviso duplicado',
       s == 200 and j.get('aceite_nome') == 'Ana Teste' and pr['aceite_nome'] == 'Ana Teste' and len(hist) == 1 and len(avisos('Proposta aceita')) == 1, f'{s} {j} histórico={len(hist)}')

@etapa('COM-03', 'Início mostra o contrato pendente e cria o contrato')
def _():
    txt = inicio()
    ok('COM-03', 'Início: "Proposta aceita online: falta o contrato" para a Empresa A', 'Proposta aceita online: falta o contrato' in txt and 'Empresa A' in txt, txt[:300])
    foto('04_crm_inicio_falta_contrato')
    pg.locator('#cFluxo li', has_text='falta o contrato').locator('button').click(); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_function("location.hash.startsWith('#/contrato/')")
    kid = pg.evaluate("location.hash.split('/')[2]"); ctx_c['k'] = kid
    k = um(f"crm_contratos?id=eq.{kid}&select=proposta_id,status,tipo,valor_avulso,cliente_id")
    ok('COM-04', 'Contrato criado pelo Início, ligado à proposta, aguardando assinatura', k['proposta_id'] == ctx_c['pr']['id'] and k['status'] == 'assinatura' and k['cliente_id'] == cliA['id'], k)
    txt = inicio()
    ok('COM-05', 'Depois do contrato, o aviso "falta o contrato" some e aparece "Contrato sem projeto"', 'falta o contrato' not in txt and 'Contrato sem projeto' in txt, txt[:300])

@etapa('CTR-01', 'Transições de status do contrato')
def _():
    k = ctx_c['k']
    s, j = rest('PATCH', f'crm_contratos?id=eq.{k}', {'status': 'encerrado'}, TA)
    st_ = um(f'crm_contratos?id=eq.{k}&select=status')['status']
    ok('CTR-01', 'Contrato aguardando assinatura não pode virar encerrado (banco recusa)', s >= 400 and 'não pode virar' in json.dumps(j, ensure_ascii=False) and st_ == 'assinatura', f'{s} {j}')
    s, j = rest('PATCH', f'crm_contratos?id=eq.{k}', {'status': 'vigente'}, TA)
    ok('CTR-02', 'Ativar contrato: aguardando assinatura → vigente', s == 200 and um(f'crm_contratos?id=eq.{k}&select=status')['status'] == 'vigente', s)
    k2 = criar('crm_contratos', {'cliente_id': cliB['id'], 'titulo': 'Avulso B', 'tipo': 'avulso', 'valor_avulso': 500, 'status': 'rascunho'}, TA)['id']
    s1, _ = rest('PATCH', f'crm_contratos?id=eq.{k2}', {'status': 'cancelado'}, TA)
    s2, j2 = rest('PATCH', f'crm_contratos?id=eq.{k2}', {'status': 'vigente'}, TA)
    ok('CTR-03', 'Contrato cancelado é final: não volta a vigente', s1 == 200 and s2 >= 400 and um(f'crm_contratos?id=eq.{k2}&select=status')['status'] == 'cancelado', f'{s1} {s2} {j2}')

@etapa('PRJ-01', 'Contrato avulso vira projeto pelo Início')
def _():
    inicio(); pg.locator('#cFluxo li', has_text='Contrato sem projeto').first.locator('button').click(); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#dlgf [name=modelo]', ''); pg.fill('#dlgf [name=entrega_prevista]', dia(30)); pg.click('#dlgf button[value=ok]')
    pg.wait_for_function("location.hash.startsWith('#/projeto/')"); pid = pg.evaluate("location.hash.split('/')[2]"); ctx_c['pid'] = pid
    p = um(f"crm_projetos?id=eq.{pid}&select=contrato_id,valor,entrega_prevista,cliente_id")
    k = um(f"crm_contratos?id=eq.{ctx_c['k']}&select=projeto_id")
    ok('PRJ-01', 'Projeto ligado ao contrato, com valor e prazo, numa gravação (contrato aponta de volta)',
       p['contrato_id'] == ctx_c['k'] and float(p['valor']) == 3000 and p['entrega_prevista'] == dia(30) and k['projeto_id'] == pid, f'{p} {k}')

@etapa('POR-01', 'Cliente aprova a peça no portal')
def _():
    et = criar('crm_etapas', {'projeto_id': ctx_c['pid'], 'ordem': 1, 'titulo': 'Semana 01'}, TA)
    e1 = criar('crm_entregas', {'etapa_id': et['id'], 'ordem': 1, 'titulo': 'Post de lançamento', 'status': 'enviado', 'texto': 'Legenda final'}, TA)
    e2 = criar('crm_entregas', {'etapa_id': et['id'], 'ordem': 2, 'titulo': 'Carrossel', 'status': 'enviado', 'texto': 'Texto do carrossel'}, TA)
    e3 = criar('crm_entregas', {'etapa_id': et['id'], 'ordem': 3, 'titulo': 'Stories', 'status': 'enviado'}, TA)
    ctx_c.update(e1=e1['id'], e2=e2['id'], e3=e3['id'])
    s, j = fn('crm-portal', {'acao': 'convidar', 'cliente_id': cliA['id'], 'email': cliA['email']}, TA)
    sb_, jb = fn('crm-portal', {'acao': 'convidar', 'cliente_id': cliB['id'], 'email': cliB['email']}, TA)
    ok('POR-00', 'CRM dá acesso ao portal para A e B (senha provisória)', s == 200 and sb_ == 200 and j.get('senha') and jb.get('senha'), f'{s} {sb_}')
    ctx_c['senhaB'] = jb['senha']
    p3 = nova_pagina(); p3.goto(WEB + '/portal.html'); p3.wait_for_selector('#fEntrar')
    p3.fill('#fEntrar [name=email]', cliA['email']); p3.fill('#fEntrar [name=senha]', j['senha']); p3.click('#fEntrar button')
    p3.wait_for_selector('#fSenha'); p3.fill('#fSenha [name=nova]', 'Senha-Nova-A-2026'); p3.fill('#fSenha [name=repete]', 'Senha-Nova-A-2026'); p3.click('#fSenha button.btn-gold')
    p3.wait_for_selector('#vPortal:not([hidden])'); p3.wait_for_selector('[data-aprovar]')
    ok('POR-0A', 'Cliente A entra no portal, troca a senha provisória e vê as peças para aprovar',
       'Ana' in p3.inner_text('#ola') and p3.text_content('#frase') and p3.locator('[data-aprovar]').count() == 3, p3.inner_text('#ola') + ' · ' + (p3.text_content('#frase') or ''))
    foto('05_portal_para_aprovar', p3)
    p3.locator('article.painel', has_text='Post de lançamento').locator('[data-aprovar]').click(); p3.wait_for_function("document.querySelectorAll('[data-aprovar]').length === 2")
    x = um(f"crm_entregas?id=eq.{e1['id']}&select=status,aprovado_em")
    hist = adm_sr('GET', f"crm_interacoes?cliente_id=eq.{cliA['id']}&resumo=ilike.*aprovou*&select=id")[1]
    ok('POR-01', 'Aprovar no portal: peça aprovada com data, histórico e aviso', x['status'] == 'aprovado' and x['aprovado_em'] and len(hist) == 1 and len(avisos('Aprovado pelo cliente')) == 1, f'{x} histórico={len(hist)} avisos={avisos("Aprovado")}')
    foto('06_portal_aprovado', p3); p3.close()
    ctx_c['TA_cli'] = entrar(cliA['email'], 'Senha-Nova-A-2026'); ctx_c['TB_cli'] = entrar(cliB['email'], jb['senha'])

@etapa('POR-02', 'Cliente pede alteração')
def _():
    s, j = fn('crm-portal', {'acao': 'alterar', 'entrega_id': ctx_c['e2'], 'comentario': 'Trocar a foto da capa'}, ctx_c['TA_cli'])
    x = um(f"crm_entregas?id=eq.{ctx_c['e2']}&select=status,revisoes")
    t = adm_sr('GET', f"crm_tarefas?cliente_id=eq.{cliA['id']}&origem=eq.portal&select=titulo,prioridade,descricao")[1]
    ok('POR-02', 'Pedir alteração: peça em revisão, +1 rodada, tarefa de prioridade alta, histórico e aviso',
       s == 200 and x['status'] == 'revisao' and x['revisoes'] == 1 and len(t) == 1 and t[0]['prioridade'] == 'alta' and t[0]['descricao'] == 'Trocar a foto da capa' and len(avisos('pediu alteração')) == 1, f'{s} {x} {t}')
    s, j = fn('crm-portal', {'acao': 'alterar', 'entrega_id': ctx_c['e2'], 'comentario': 'De novo'}, ctx_c['TA_cli'])
    ok('POR-03', 'Peça já em revisão não recebe outro pedido (só o que está "enviado")', s == 409 and um(f"crm_entregas?id=eq.{ctx_c['e2']}&select=revisoes")['revisoes'] == 1, f'{s} {j}')

# ---------- 6) isolamento entre clientes ----------
@etapa('SEG-01', 'Cliente B não vê dados do cliente A')
def _():
    s, j = fn('crm-portal', {'acao': 'dados'}, ctx_c['TB_cli'])
    texto = json.dumps(j, ensure_ascii=False)
    ok('SEG-01', 'Portal do cliente B não traz nada do cliente A', s == 200 and 'Empresa A' not in texto and 'Post de lançamento' not in texto and 'Ana' not in texto, f'{s} projetos={len(j.get("projetos", []))}')
    s2, j2 = fn('crm-portal', {'acao': 'dados'}, ctx_c['TA_cli'])
    ok('SEG-01b', 'Portal do cliente A traz só o projeto dele', s2 == 200 and 'Post de lançamento' in json.dumps(j2, ensure_ascii=False) and 'Empresa B' not in json.dumps(j2, ensure_ascii=False), s2)
    s3, j3 = rest('GET', 'crm_entregas?select=id,titulo', token=ctx_c['TA_cli'])
    s4, j4 = rest('GET', 'crm_clientes?select=id,nome', token=None)
    anon_ok = (s4 == 200 and j4 == []) or s4 in (401, 403)
    ok('SEG-03', 'Cliente logado e visitante anônimo não leem as tabelas do CRM direto', s3 == 200 and j3 == [] and anon_ok, f'cliente: {s3} {j3} · anônimo: {s4} {j4}')

@etapa('SEG-02', 'Cliente B tenta mexer na peça do cliente A')
def _():
    s, j = fn('crm-portal', {'acao': 'aprovar', 'entrega_id': ctx_c['e3']}, ctx_c['TB_cli'])
    x = um(f"crm_entregas?id=eq.{ctx_c['e3']}&select=status")
    ok('SEG-02', 'Aprovar peça de outro cliente: recusado e nada muda no banco', s == 404 and x['status'] == 'enviado', f'{s} {j} status={x["status"]}')
    s, j = fn('crm-portal', {'acao': 'convidar', 'cliente_id': cliA['id'], 'email': 'intruso@teste.dev'}, ctx_c['TB_cli'])
    ok('SEG-04', 'Cliente não consegue dar acesso ao portal (ação só de admin)', s == 403, f'{s} {j}')
    s, j = rest('POST', 'rpc/crm_proposta_aceitar', {'p_token': ctx_c['token'], 'p_nome': 'x'}, token=None)
    s2, j2 = rest('POST', 'rpc/crm_portal_entrega', {'p_cliente': cliB['id'], 'p_entrega': ctx_c['e3'], 'p_acao': 'aprovar'}, token=ctx_c['TB_cli'])
    ok('SEG-05', 'Funções sensíveis do banco não podem ser chamadas direto (só pelas funções do servidor)', s >= 400 and s2 >= 400 and um(f"crm_entregas?id=eq.{ctx_c['e3']}&select=status")['status'] == 'enviado', f'anônimo: {s} · cliente B: {s2}')

# ---------- 7) validade do link ----------
def proposta_enviada(cliente, titulo, validade=dia(10), extra=None):
    p = criar('crm_propostas', {'cliente_id': cliente, 'titulo': titulo, 'valor': 100, 'validade': validade, **(extra or {})}, TA)
    s_, j_ = decidir(p['id'], 'enviada'); assert s_ == 200, (s_, j_)
    return um(f"crm_propostas?id=eq.{p['id']}&select=id,grupo,token,status")
@etapa('VER', 'Links de proposta inválidos, vencidos, recusados ou antigos')
def _():
    s, j = fn('crm-proposta', {'acao': 'ver', 'token': 'f' * 32}, chave=None)
    s2, j2 = fn('crm-proposta', {'acao': 'ver', 'token': "x' or 1=1"}, chave=None)
    ok('VER-03', 'Link inválido: 404 sem dados comerciais', s == 404 and s2 == 404 and 'titulo' not in json.dumps(j) and 'valor' not in json.dumps(j), f'{s} {j} · {s2}')
    p = proposta_enviada(cliB['id'], 'Vencida'); rest('PATCH', f"crm_propostas?id=eq.{p['id']}", {'validade': dia(-1)}, TA)
    s, j = fn('crm-proposta', {'acao': 'aceitar', 'token': p['token'], 'nome': 'Bruno Teste'}, chave=None)
    ok('VER-01', 'Proposta vencida: aceite bloqueado e proposta continua enviada', s == 409 and um(f"crm_propostas?id=eq.{p['id']}&select=status")['status'] == 'enviada', f'{s} {j}')
    p = proposta_enviada(cliB['id'], 'Recusada'); decidir(p['id'], 'recusada', 'Cliente achou caro')
    s, j = fn('crm-proposta', {'acao': 'aceitar', 'token': p['token'], 'nome': 'Bruno Teste'}, chave=None)
    ok('VER-02', 'Proposta recusada: aceite bloqueado', s == 409 and um(f"crm_propostas?id=eq.{p['id']}&select=status")['status'] == 'recusada', f'{s} {j}')
    p1 = proposta_enviada(cliB['id'], 'Versionada')
    v2 = criar('crm_propostas', {'grupo': p1['grupo'], 'versao': 2, 'cliente_id': cliB['id'], 'titulo': 'Versionada', 'valor': 120, 'validade': dia(10)}, TA)
    decidir(v2['id'], 'enviada'); t2 = um(f"crm_propostas?id=eq.{v2['id']}&select=token")['token']
    s, j = fn('crm-proposta', {'acao': 'aceitar', 'token': p1['token'], 'nome': 'Bruno Teste'}, chave=None)
    sv, jv = fn('crm-proposta', {'acao': 'ver', 'token': p1['token']}, chave=None)
    s2, j2 = fn('crm-proposta', {'acao': 'aceitar', 'token': t2, 'nome': 'Bruno Teste'}, chave=None)
    ok('VER-04', 'Versão substituída não pode ser aceita; a nova pode', s == 409 and jv.get('atualizada') is True and s2 == 200 and t2 != p1['token'], f'v1: {s} {j} · v2: {s2}')
    s, j = decidir(v2['id'], 'enviada')
    ok('CTR-P2', 'Proposta aceita online não volta para enviada', s >= 400 and um(f"crm_propostas?id=eq.{v2['id']}&select=status")['status'] == 'aprovada', f'{s} {j}')

# ---------- 8) renovação no Início ----------
@etapa('CTR-04', 'Aviso de renovação')
def _():
    k = criar('crm_contratos', {'cliente_id': cliB['id'], 'titulo': 'Gestão B', 'tipo': 'avulso', 'valor_avulso': 900, 'status': 'vigente', 'inicio': dia(-300), 'fim': dia(10), 'aviso_dias': 30}, TA)
    criar('crm_projetos', {'cliente_id': cliB['id'], 'nome': 'Projeto B', 'contrato_id': k['id']}, TA)  # tem projeto: só o aviso de renovação interessa
    txt = inicio(); tem = lambda t: 'Gestão B' in t and 'preparar renovação' in t
    ok('CTR-04a', 'Contrato perto do fim sem proposta: Início pede a renovação', tem(txt), txt[:300])
    criar('crm_propostas', {'cliente_id': cliB['id'], 'titulo': 'Fotos de produto', 'valor': 400, 'validade': dia(10)}, TA)
    ok('CTR-04b', 'Proposta de OUTRO serviço do mesmo cliente não esconde a renovação', tem(inicio()))
    rn = criar('crm_propostas', {'cliente_id': cliB['id'], 'titulo': 'Renovação · Gestão B', 'valor': 900, 'validade': dia(10), 'renova_contrato': k['id']}, TA)
    ok('CTR-04c', 'Com a proposta de renovação deste contrato, o aviso some', not tem(inicio()))
    decidir(rn['id'], 'enviada'); decidir(rn['id'], 'recusada', 'Cliente não vai renovar')
    ok('CTR-04d', 'Renovação recusada: o aviso volta', tem(inicio()))
    foto('07_crm_inicio_renovacao')

# ---------- 9) contrato mensal: mês pelo Início e concorrência ----------
@etapa('PRJ-02', 'Mês de conteúdo do contrato mensal')
def _():
    k = criar('crm_contratos', {'cliente_id': cliA['id'], 'titulo': 'Redes mensal A', 'tipo': 'recorrente', 'valor_mensal': 1500, 'posts_mes': 8, 'ajustes_inclusos': 1, 'status': 'vigente', 'inicio': dia(0)}, TA)
    txt = inicio()
    ok('PRJ-02a', 'Início oferece criar o mês atual do contrato mensal', 'Empresa A · 8 posts' in txt, txt[:300])
    pg.locator('#cFluxo li', has_text='8 posts').first.locator('button').click(); pg.wait_for_function("location.hash.startsWith('#/projeto/')")
    pid = pg.evaluate("location.hash.split('/')[2]")
    p = um(f"crm_projetos?id=eq.{pid}&select=contrato_id,mes,valor,crm_etapas(consulta,crm_entregas(id))")
    posts = sum(len(e['crm_entregas']) for e in p['crm_etapas'] if not e['consulta'])
    ok('PRJ-02', 'Mês criado ligado ao contrato, no mês atual, com os 8 posts do escopo e o valor mensal', p['contrato_id'] == k['id'] and p['mes'] == MES and posts == 8 and float(p['valor']) == 1500, f"mes={p['mes']} posts={posts}")
    foto('08_crm_mes_criado')
    MESES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
    atual = f'Criar {MESES[HOJE.month - 1]} {HOJE.year}'
    inicio(); linhas = [t for t in pg.locator('#cFluxo li').all_inner_texts() if '8 posts' in t] if pg.locator('#cFluxo').count() else []
    ok('PRJ-02b', 'Depois de criado, o Início não oferece o mesmo mês de novo', not any(atual in t for t in linhas), linhas)
    # concorrência: duas criações do mês seguinte ao mesmo tempo
    seg = (HOJE.replace(day=28) + datetime.timedelta(days=4)).strftime('%Y-%m')
    corpo = {'p_cliente': cliA['id'], 'p_nome': 'Concorrência', 'p_modelo': None, 'p_estrutura': [{'titulo': 'Semana 01', 'entregas': ['Post']}], 'p_contrato': k['id'], 'p_mes': seg}
    with concurrent.futures.ThreadPoolExecutor(2) as ex:
        rs = list(ex.map(lambda _: rest('POST', 'rpc/crm_projeto_de_modelo', corpo, TA), range(2)))
    n = len(adm_sr('GET', f"crm_projetos?contrato_id=eq.{k['id']}&mes=eq.{seg}&select=id")[1])
    ok('DUP-01', 'Criar o mesmo mês duas vezes ao mesmo tempo: uma passa, a outra é recusada, um projeto só',
       sorted(s for s, _ in rs)[0] == 200 and sorted(s for s, _ in rs)[1] >= 400 and n == 1, f'respostas={[s for s, _ in rs]} projetos={n} · {rs[1][1] if rs[1][0] >= 400 else rs[0][1]}')

# ---------- 10) regras comerciais (A2): proposta e funil na mesma transação ----------
def nova_op(cliente, titulo, etapa='negociacao'):
    return criar('crm_oportunidades', {'cliente_id': cliente, 'titulo': titulo, 'etapa': etapa, 'valor': 2000}, TA)
def hist(cliente, trecho):
    return adm_sr('GET', f"crm_interacoes?cliente_id=eq.{cliente}&resumo=ilike.*{urllib.parse.quote(trecho)}*&select=id,resumo")[1]
A2 = {}

@etapa('REG-01', 'Status da proposta não muda direto no banco')
def _():
    p = proposta_enviada(cliA['id'], 'Direto')
    s, j = rest('PATCH', f"crm_propostas?id=eq.{p['id']}", {'status': 'aprovada'}, TA)
    ok('REG-01', 'Mudar o status da proposta direto no banco é recusado (só pela proposta, para o funil acompanhar)',
       s >= 400 and 'pelos botões da proposta' in json.dumps(j, ensure_ascii=False) and um(f"crm_propostas?id=eq.{p['id']}&select=status")['status'] == 'enviada', f'{s} {j}')

@etapa('A2-01', 'Aprovar a proposta à mão pela tela')
def _():
    op = nova_op(cliA['id'], 'Identidade visual'); p = proposta_enviada(cliA['id'], 'Identidade visual', extra={'oportunidade_id': op['id']})
    A2.update(op1=op['id'], p1=p['id'])
    pg.goto('about:blank'); pg.goto(CRM + f"/app.html#/proposta/{p['id']}"); pg.wait_for_selector('[data-st=aprovada]')
    pg.click('[data-st=aprovada]'); pg.wait_for_function("!document.querySelector('[data-st=aprovada]')")
    pg.wait_for_timeout(500)
    sem_dialogo = not pg.is_visible('#dlg[open]')
    pr = um(f"crm_propostas?id=eq.{p['id']}&select=status,aceite_em")
    o = um(f"crm_oportunidades?id=eq.{op['id']}&select=etapa,fechado_em")
    ks = adm_sr('GET', f"crm_contratos?proposta_id=eq.{p['id']}&select=id")[1]
    pj = adm_sr('GET', f"crm_projetos?oportunidade_id=eq.{op['id']}&select=id")[1]
    h = hist(cliA['id'], 'Identidade visual” (v1) aprovada')
    ok('A2-01', 'Aprovar à mão: proposta aprovada e funil em Fechado na mesma operação; nenhum contrato ou projeto criado; histórico',
       pr['status'] == 'aprovada' and pr['aceite_em'] is None and o['etapa'] == 'ganho' and o['fechado_em'] and not ks and not pj and len(h) == 1 and sem_dialogo,
       f"proposta={pr['status']} funil={o['etapa']} contratos={len(ks)} projetos={len(pj)} histórico={len(h)} sem pergunta de contrato={sem_dialogo}")
    txt = inicio()
    ok('A2-01b', 'Início mostra "Proposta aprovada: falta o contrato", como no aceite pelo link', 'Proposta aprovada: falta o contrato' in txt and 'Identidade visual' in txt, txt[:300])
    foto('09_crm_aprovada_manual')

@etapa('A2-05', 'Repetir a aprovação')
def _():
    antes = um(f"crm_oportunidades?id=eq.{A2['op1']}&select=fechado_em")['fechado_em']
    s, j = decidir(A2['p1'], 'aprovada')
    depois = um(f"crm_oportunidades?id=eq.{A2['op1']}&select=fechado_em")['fechado_em']
    ok('A2-05', 'Aprovar de novo: nada muda (sem novo histórico, funil intacto)',
       s == 200 and j.get('ja') is True and antes == depois and len(hist(cliA['id'], 'Identidade visual” (v1) aprovada')) == 1, f'{s} {j}')

@etapa('A2-02', 'Recusa sem motivo')
def _():
    op = nova_op(cliA['id'], 'Site institucional'); p = proposta_enviada(cliA['id'], 'Site institucional', extra={'oportunidade_id': op['id']})
    A2.update(op2=op['id'], p2=p['id'])
    pg.goto('about:blank'); pg.goto(CRM + f"/app.html#/proposta/{p['id']}"); pg.wait_for_selector('[data-st=recusada]')
    pg.click('[data-st=recusada]'); pg.wait_for_selector('#dlg[open] [name=motivo]')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ainda_aberto = pg.is_visible('#dlg[open]')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(300)
    s, j = decidir(p['id'], 'recusada', '  ')
    pr = um(f"crm_propostas?id=eq.{p['id']}&select=status"); o = um(f"crm_oportunidades?id=eq.{op['id']}&select=etapa,motivo_perda")
    ok('A2-02', 'Recusar exige o motivo: a tela não deixa sair sem ele e o banco recusa motivo vazio; nada muda',
       ainda_aberto and s >= 400 and 'motivo' in json.dumps(j, ensure_ascii=False) and pr['status'] == 'enviada' and o['etapa'] == 'negociacao' and not o['motivo_perda'], f'tela aberta={ainda_aberto} banco={s} {j}')

@etapa('A2-03', 'Recusar com motivo pela tela')
def _():
    pg.goto('about:blank'); pg.goto(CRM + f"/app.html#/proposta/{A2['p2']}"); pg.wait_for_selector('[data-st=recusada]')
    pg.click('[data-st=recusada]'); pg.wait_for_selector('#dlg[open] [name=motivo]')
    pg.fill('#dlgf [name=motivo]', 'Cliente decidiu adiar para março'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_function("!document.querySelector('[data-st=recusada]')")
    pr = um(f"crm_propostas?id=eq.{A2['p2']}&select=status"); o = um(f"crm_oportunidades?id=eq.{A2['op2']}&select=etapa,motivo_perda,fechado_em")
    h = hist(cliA['id'], 'Site institucional” (v1) recusada')
    ok('A2-03', 'Recusar com motivo: proposta recusada, funil em Perdido com o motivo, histórico, na mesma operação',
       pr['status'] == 'recusada' and o['etapa'] == 'perdido' and o['motivo_perda'] == 'Cliente decidiu adiar para março' and o['fechado_em'] and len(h) == 1, f'{pr} {o} histórico={len(h)}')

@etapa('A2-04', 'Falha no meio da operação')
def _():
    op = nova_op(cliA['id'], 'Falha proposital'); p = proposta_enviada(cliA['id'], 'Falha proposital', extra={'oportunidade_id': op['id']})
    psql("alter table public.crm_interacoes add constraint teste_falha check (resumo not like 'Proposta “Falha proposital%') not valid")
    try: s, j = decidir(p['id'], 'aprovada')
    finally: psql("alter table public.crm_interacoes drop constraint teste_falha")
    pr = um(f"crm_propostas?id=eq.{p['id']}&select=status"); o = um(f"crm_oportunidades?id=eq.{op['id']}&select=etapa,fechado_em")
    ok('A2-04', 'Se a última gravação (histórico) falha, nada fica: proposta continua enviada e o funil não muda',
       s >= 400 and pr['status'] == 'enviada' and o['etapa'] == 'negociacao' and not o['fechado_em'], f'{s} proposta={pr["status"]} funil={o["etapa"]}')

@etapa('A2-06', 'Conflito com oportunidade já encerrada')
def _():
    op = nova_op(cliA['id'], 'Fotos', etapa='perdido'); p = proposta_enviada(cliA['id'], 'Fotos', extra={'oportunidade_id': op['id']})
    s, j = decidir(p['id'], 'aprovada')
    pr = um(f"crm_propostas?id=eq.{p['id']}&select=status"); o = um(f"crm_oportunidades?id=eq.{op['id']}&select=etapa")
    ok('A2-06', 'Aprovar com o cartão em Perdido: recusado com mensagem clara; proposta e funil intactos',
       s >= 400 and 'já está encerrada como Perdido' in json.dumps(j, ensure_ascii=False) and pr['status'] == 'enviada' and o['etapa'] == 'perdido', f'{s} {j}')
    op2 = nova_op(cliA['id'], 'Vídeo', etapa='ganho'); p2 = proposta_enviada(cliA['id'], 'Vídeo', extra={'oportunidade_id': op2['id']})
    s2, j2 = decidir(p2['id'], 'recusada', 'Mudou de ideia')
    ok('A2-06b', 'Recusar com o cartão em Fechado: recusado; nada sobrescrito',
       s2 >= 400 and 'já está encerrada como Fechado' in json.dumps(j2, ensure_ascii=False) and um(f"crm_oportunidades?id=eq.{op2['id']}&select=etapa")['etapa'] == 'ganho'
       and um(f"crm_propostas?id=eq.{p2['id']}&select=status")['status'] == 'enviada', f'{s2} {j2}')

@etapa('A2-07', 'Aceite online com o cartão em Perdido')
def _():
    op = nova_op(cliA['id'], 'Podcast', etapa='perdido'); p = proposta_enviada(cliA['id'], 'Podcast', extra={'oportunidade_id': op['id']})
    s, j = fn('crm-proposta', {'acao': 'aceitar', 'token': p['token'], 'nome': 'Ana Teste'}, chave=None)
    pr = um(f"crm_propostas?id=eq.{p['id']}&select=status,aceite_nome"); o = um(f"crm_oportunidades?id=eq.{op['id']}&select=etapa")
    h = hist(cliA['id'], 'Podcast” (v1) aceita online')
    ok('A2-07', 'Aceite do cliente vale, o cartão em Perdido não é sobrescrito, histórico e aviso dizem para revisar o funil',
       s == 200 and pr['status'] == 'aprovada' and o['etapa'] == 'perdido' and len(h) == 1 and 'não foi alterada' in h[0]['resumo'] and len(avisos('revise o Funil')) == 1,
       f"{s} proposta={pr['status']} funil={o['etapa']} avisos={avisos('revise o Funil')}")

@etapa('REV-01', 'Desfazer aprovação manual')
def _():
    k = criar('crm_contratos', {'cliente_id': cliA['id'], 'proposta_id': A2['p1'], 'titulo': 'Identidade visual', 'tipo': 'avulso', 'valor_avulso': 2000, 'status': 'assinatura'}, TA)
    antes = um(f"crm_oportunidades?id=eq.{A2['op1']}&select=etapa,fechado_em")
    s, j = decidir(A2['p1'], 'enviada')
    pr = um(f"crm_propostas?id=eq.{A2['p1']}&select=status"); o = um(f"crm_oportunidades?id=eq.{A2['op1']}&select=etapa,fechado_em")
    ks = adm_sr('GET', f"crm_contratos?id=eq.{k['id']}&select=id,status")[1]
    ok('REV-01', 'Desfazer a aprovação manual: só a proposta volta a enviada; funil continua Fechado, contrato e histórico ficam, reabertura registrada',
       s == 200 and pr['status'] == 'enviada' and o == antes and len(ks) == 1 and len(hist(cliA['id'], 'Identidade visual” (v1) aprovada')) == 1
       and len(hist(cliA['id'], 'Identidade visual” (v1) reaberta')) == 1 and j.get('funil_alterado') is False, f'{s} {j} funil={o["etapa"]} contrato={len(ks)}')

@etapa('REV-02', 'Reabrir proposta recusada')
def _():
    s, j = decidir(A2['p2'], 'enviada')
    pr = um(f"crm_propostas?id=eq.{A2['p2']}&select=status"); o = um(f"crm_oportunidades?id=eq.{A2['op2']}&select=etapa,motivo_perda")
    ok('REV-02', 'Reabrir a recusada: só a proposta volta a enviada; funil continua Perdido com o motivo; recusa e reabertura no histórico',
       s == 200 and pr['status'] == 'enviada' and o['etapa'] == 'perdido' and o['motivo_perda'] == 'Cliente decidiu adiar para março'
       and len(hist(cliA['id'], 'Site institucional” (v1) recusada')) == 1 and len(hist(cliA['id'], 'Site institucional” (v1) reaberta')) == 1, f'{s} {j} {o}')

@etapa('DUP-03', 'Mês duplicado: mensagem clara')
def _():
    k = criar('crm_contratos', {'cliente_id': cliB['id'], 'titulo': 'Redes mensal B', 'tipo': 'recorrente', 'valor_mensal': 900, 'posts_mes': 4, 'status': 'vigente', 'inicio': dia(0)}, TA)
    pg.goto('about:blank'); pg.goto(CRM + f"/app.html#/contrato/{k['id']}"); pg.wait_for_selector(f'[data-criar-mes="{MES}"]')
    s, existente = rest('POST', 'rpc/crm_projeto_de_modelo', {'p_cliente': cliB['id'], 'p_nome': 'Outra aba', 'p_modelo': None, 'p_estrutura': [], 'p_contrato': k['id'], 'p_mes': MES}, TA)
    pg.click(f'[data-criar-mes="{MES}"]'); pg.wait_for_function(f"location.hash === '#/projeto/{existente}'")
    t = pg.inner_text('#toast')
    n = len(adm_sr('GET', f"crm_projetos?contrato_id=eq.{k['id']}&mes=eq.{MES}&select=id")[1])
    ok('DUP-03', 'Mês já criado (por outra aba): mensagem clara, sem termo técnico, e abre o projeto que já existe; um projeto só',
       'O projeto deste mês já existe para este contrato' in t and 'duplicate' not in t.lower() and n == 1, f'aviso="{t}" projetos={n}')

# ---------- fim ----------
ok('SEG-06', 'Nenhum pedido do navegador foi para produção', not bloqueados, bloqueados[:5])
ok('INF-05', 'Nenhum erro de JavaScript nas telas durante o teste', not falhas_browser, falhas_browser[:5])
nav.close(); pw.stop()

total, bons = len(resultados), sum(r['ok'] for r in resultados)
linhas = [f'# Relatório do teste integrado', '', f'- Data: {datetime.datetime.now().isoformat(timespec="seconds")}',
          f"- Commits: CRM `{COMMITS['crm']}` · site `{COMMITS['site']}`", f'- Supabase: temporário e local ({API}); produção bloqueada',
          f'- Resultado: **{bons} de {total} passaram**', '', '| ID | Cenário | Resultado | Evidência |', '|---|---|---|---|']
linhas += [f"| {r['id']} | {r['cenario']} | {'✅' if r['ok'] else '❌ FALHOU'} | {r['evidencia'].replace('|', '/')[:220]} |" for r in resultados]
(SAIDA / 'relatorio.md').write_text('\n'.join(linhas) + '\n', encoding='utf-8')
(SAIDA / 'resultado.json').write_text(json.dumps({'commits': COMMITS, 'resultados': resultados}, ensure_ascii=False, indent=1), encoding='utf-8')
if os.environ.get('GITHUB_STEP_SUMMARY'): open(os.environ['GITHUB_STEP_SUMMARY'], 'a', encoding='utf-8').write('\n'.join(linhas) + '\n')
print(f'\n{bons} de {total} passaram'); sys.exit(0 if bons == total else 1)
