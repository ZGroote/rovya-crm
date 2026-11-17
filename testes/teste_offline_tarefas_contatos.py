# tarefas e registro de contato sem internet: fila, ⏳ nas telas, envio na ordem, aviso de conflito
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 390, 'height': 844}); pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and erros.append('console: ' + m.text))
    base = 'http://localhost:8777/_mock.html'
    pg.goto(base + '#/tarefas'); pg.wait_for_selector('#nTarefa'); pg.evaluate('navigator.serviceWorker.ready')
    pg.evaluate("localStorage.setItem('rovya-copia-em', Date.now())")  # sem cópia completa no meio do teste
    pg.reload(); pg.wait_for_selector('#nTarefa')
    ctx.set_offline(True); pg.reload(); pg.wait_for_selector('#nTarefa', timeout=15000)
    fila = lambda: pg.evaluate("JSON.parse(localStorage.getItem('rovya-escritas-pendentes') || '[]')")

    # 1) nova tarefa sem internet
    pg.click('#nTarefa'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Ligar para a gráfica'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ok('guardado neste aparelho' in pg.inner_text('#toast'), 'nova tarefa: avisa que ficou no aparelho')
    ok(pg.locator('li[data-tarefa]', has_text='Ligar para a gráfica').locator('.pill.pend').count() == 1, 'nova tarefa aparece na lista com ⏳')
    # 2) concluir t1 sem internet: some das abertas, aparece nas feitas
    pg.click('[data-feita="t1"]'); pg.wait_for_timeout(500)
    ok(pg.locator('li[data-tarefa="t1"]').count() == 0, 'tarefa concluída sai das abertas')
    pg.click('[data-f=feitas]'); pg.wait_for_timeout(300)
    ok(pg.locator('li[data-tarefa="t1"] .pill.pend').count() == 1, 'e aparece nas feitas com ⏳')
    pg.click('[data-f=abertas]'); pg.wait_for_timeout(300)
    # 3) editar t2 sem internet (título)
    pg.locator('li[data-tarefa="t2"] b').click(); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Renovar Canva (anual)'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ok('Renovar Canva (anual)' in pg.inner_text('main'), 'edição aparece na lista')
    # 4) nova tarefa pela aba do projeto
    pg.goto(base + '#/projeto/pr1'); pg.wait_for_timeout(800)
    aba = pg.locator('.tabs button', has_text='Tarefas')
    if aba.count(): aba.first.click(); pg.wait_for_timeout(400)
    if pg.locator('[data-nova-tarefa]').count():
        pg.click('[data-nova-tarefa]'); pg.wait_for_selector('#dlg[open]')
        pg.fill('#dlgf [name=titulo]', 'Briefing da revista'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
        f = [o for o in fila() if o['acao'] == 'insert' and o['dados']['titulo'] == 'Briefing da revista']
        ok(bool(f) and f[0]['dados'].get('projeto_id') == 'pr1', 'tarefa do projeto guarda o projeto mesmo sem internet')
    else: ok(False, 'aba de tarefas do projeto não encontrada')
    # 5) registrar contato sem internet na ficha da Marina (c2)
    pg.goto(base + '#/cliente/c2'); pg.wait_for_selector('#nHist')
    pg.click('#nHist'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=resumo]', 'Ligou pedindo ajuste no orçamento.'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(600)
    ok(pg.locator('li[data-hist]', has_text='ajuste no orçamento').locator('.pill.pend').count() == 1, 'contato aparece no histórico com ⏳')
    ok(len(fila()) == 5, f'5 alterações na fila (tem {len(fila())})')
    pg.goto(base + '#/'); pg.wait_for_selector('.avisos')
    ok('5 alteração(ões)' in pg.inner_text('.avisos'), 'Início avisa as alterações guardadas')
    ok('Tarefas, contatos e compromissos' in pg.evaluate("getComputedStyle(document.querySelector('#main'), '::before').content"), 'faixa fala de tarefas e contatos')
    pg.screenshot(path=os.path.join(S, 't6e_inicio.png'))

    # 6) volta a internet; antes, "outro aparelho" mudou a prioridade da t2
    pg.evaluate("window.__D.crm_tarefas.find(t => t.id === 't2').prioridade = 'alta'; window.__log.length = 0")
    ctx.set_offline(False); pg.wait_for_timeout(2500)
    log = pg.evaluate('window.__log')
    escr = [(t, k) for t, k, a in log if k in ('insert', 'update', 'delete') and t != 'crm_falhas']
    print('     escritas:', escr)
    ok(escr == [('crm_tarefas', 'insert'), ('crm_tarefas', 'update'), ('crm_tarefas', 'update'), ('crm_tarefas', 'insert'), ('crm_interacoes', 'insert')], 'enviadas na ordem em que foram feitas')
    ins = [a[0] for t, k, a in log if t == 'crm_tarefas' and k == 'insert']
    ok(all(len(x.get('id', '')) == 36 for x in ins), 'inserções levam id do aparelho (reenviar não duplica)')
    falhas = [a[0]['mensagem'] for t, k, a in log if t == 'crm_falhas' and k == 'insert']
    print('     avisos:', falhas)
    ok(len(falhas) == 1 and 'prioridade' in falhas[0], 'um aviso só: conflito de prioridade na tarefa do Canva')
    ok(fila() == [], 'fila vazia')
    print('     toast:', pg.inner_text('#toast'))
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
