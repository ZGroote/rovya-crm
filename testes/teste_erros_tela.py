# Erro de código na tela vira registro em crm_falhas (origem 'tela'), sem repetir, no máximo 5 por visita,
# nada sem internet, e o Início não mostra esses erros (são para quem mantém o CRM, não para a Sabrina).
import os, sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(); pg = ctx.new_page()
    base = 'http://localhost:8777/_mock.html'
    pg.goto(base + '#/tarefas'); pg.wait_for_selector('#nTarefa')
    pg.evaluate("localStorage.setItem('rovya-copia-em', Date.now())")
    registros = lambda: [a[0] for t, k, a in pg.evaluate('window.__log') if t == 'crm_falhas' and k == 'insert']
    # erro saindo de um script da própria página
    jogar = lambda msg: pg.evaluate(f"(() => {{ const s = document.createElement('script'); s.textContent = 'throw new Error(' + JSON.stringify({msg!r}) + ')'; document.body.append(s); }})()")
    pg.evaluate('window.__log.length = 0')
    jogar('quebrou a lista'); pg.wait_for_timeout(300)
    r = registros()
    ok(len(r) == 1 and r[0]['origem'] == 'tela' and 'quebrou a lista' in r[0]['mensagem'] and r[0]['acao'] == '#/tarefas', 'erro vira registro com a tela onde aconteceu')
    if r: print('     registro:', r[0])
    jogar('quebrou a lista'); pg.wait_for_timeout(300)
    ok(len(registros()) == 1, 'o mesmo erro não repete')
    pg.evaluate("setTimeout(() => Promise.reject(new Error('promessa sem tratamento')), 0)"); pg.wait_for_timeout(300)
    ok(any('promessa sem tratamento' in x['mensagem'] for x in registros()), 'promessa rejeitada sem tratamento também entra')
    for i in range(6): jogar(f'erro {i}')
    pg.wait_for_timeout(500)
    ok(len(registros()) == 5, f'no máximo 5 por visita (tem {len(registros())})')
    pg.reload(); pg.wait_for_selector('#nTarefa'); pg.evaluate('window.__log.length = 0')
    ctx.set_offline(True); jogar('Failed to fetch'); jogar('outro erro sem rede'); pg.wait_for_timeout(400)
    ok(registros() == [], 'sem internet nada é registrado')
    ctx.set_offline(False)
    pg.evaluate('window.__log.length = 0'); pg.goto(base + '#/'); pg.wait_for_selector('h1'); pg.wait_for_timeout(500)
    ok(['origem', 'tela'] in [a for t, k, a in pg.evaluate('window.__log') if t == 'crm_falhas' and k == 'neq'], 'Início não mostra os erros de tela')
    # saiu da Agenda antes do Google responder: a tela nova não vira "Não consegui carregar" e nada é registrado (17/11: #/relatorios e #/financeiro)
    pg.evaluate("""() => { const f = window.fetch; window.fetch = (u, o) => String(u).includes('functions/v1') ? new Promise(ok => setTimeout(() => ok(f(u, o)), 900)) : f(u, o); }""")
    pg.evaluate('window.__log.length = 0'); pg.evaluate("location.hash = '#/agenda'"); pg.wait_for_timeout(150); pg.evaluate("location.hash = '#/relatorios'"); pg.wait_for_timeout(1800)
    ok('Não consegui carregar' not in pg.inner_text('#main') and pg.locator('#main h1').inner_text() == 'Relatórios', 'saiu da Agenda antes do Google responder: Relatórios abre normal')
    ok(registros() == [], 'e não registra erro falso')
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
