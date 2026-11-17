# CRM sem internet (mock): abre do cache, agenda guarda no aparelho, envia ao voltar, avisa conflito; estrutura do Drive editável
import sys, json
from playwright.sync_api import sync_playwright
import os
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
base = 'http://localhost:8777/_mock.html'
erros = []
def ok(cond, msg):
    print(('OK   ' if cond else 'FALHA'), msg)
    if not cond: erros.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 390, 'height': 844})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    pg.on('console', lambda m: m.type == 'error' and 'Failed to load resource' not in m.text and erros.append('console: ' + m.text))

    # 1) com internet: abre, o service worker assume e guarda os arquivos
    pg.goto(base + '#/'); pg.wait_for_selector('h1')
    pg.evaluate("navigator.serviceWorker.ready"); pg.reload(); pg.wait_for_selector('h1'); pg.wait_for_timeout(1500)
    ok(pg.evaluate("!!navigator.serviceWorker.controller"), 'service worker controla a página')

    # 2) sem internet: recarrega e o CRM abre da cópia, com a faixa de aviso
    ctx.set_offline(True)
    pg.reload(); pg.wait_for_selector('h1', timeout=15000); pg.wait_for_timeout(500)
    ok('Sabrina' in pg.inner_text('h1'), 'abre sem internet (Início)')
    ok(pg.evaluate("document.body.classList.contains('sem-rede')"), 'faixa "sem internet" aparece')

    # 3) agenda sem internet: marca dois compromissos para amanhã (10h bate com o Dentista 10h30; 15h livre)
    pg.goto(base + '#/agenda'); pg.wait_for_selector('#nEv', timeout=10000)
    amanha = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv'); })()")
    for titulo, hora in [('Reunião Clínica Dias', '10:00'), ('Call Ateliê', '15:00')]:
        pg.click('#nEv'); pg.wait_for_selector('#dlg[open]')
        pg.fill('#dlgf [name=titulo]', titulo); pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', hora)
        pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    fila = pg.evaluate("JSON.parse(localStorage.getItem('rovya-agenda-pendentes') || '[]')")
    ok(len(fila) == 2, f'2 compromissos guardados no aparelho (tem {len(fila)})')
    ok(pg.locator('.ev.pendente').count() == 2, 'aparecem na agenda como pendentes')
    ok(not any(e['acao'] == 'criar' for e in pg.evaluate('window.__ev')), 'nada foi enviado ao Google sem internet')
    pg.screenshot(path=os.path.join(S, 't6_agenda_offline.png'))

    # 4) editar um pendente sem internet (muda o título) e o Início mostra o aviso da fila
    pg.locator('.ev.pendente', has_text='Call Ateliê').click(); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Call Ateliê Marina'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    fila = pg.evaluate("JSON.parse(localStorage.getItem('rovya-agenda-pendentes'))")
    ok(len(fila) == 2 and any(p['evento']['summary'] == 'Call Ateliê Marina' for p in fila), 'editar pendente troca, não duplica')
    pg.goto(base + '#/'); pg.wait_for_selector('.avisos', timeout=10000)
    ok('2 compromisso(s) guardado(s)' in pg.inner_text('.avisos'), 'Início avisa os compromissos esperando internet')
    pg.screenshot(path=os.path.join(S, 't6_inicio_offline.png'))

    # 5) volta a internet: envia os dois, avisa o conflito do das 10h, esvazia a fila
    pg.goto(base + '#/agenda'); pg.wait_for_selector('#agLista')
    pg.evaluate('window.__log.length = 0; window.__ev.length = 0')
    ctx.set_offline(False); pg.wait_for_timeout(2500)
    criados = [e['evento']['summary'] for e in pg.evaluate('window.__ev') if e['acao'] == 'criar']
    ok(sorted(criados) == ['Call Ateliê Marina', 'Reunião Clínica Dias'], f'enviados ao voltar a internet: {criados}')
    falhas = [a[0] for t, k, a in pg.evaluate('window.__log') if t == 'crm_falhas' and k == 'insert']
    ok(len(falhas) == 1 and 'Dentista' in falhas[0]['mensagem'] and falhas[0]['origem'] == 'agenda', 'um aviso de conflito (com o Dentista)')
    if falhas: print('     aviso:', falhas[0]['mensagem'])
    ok(pg.evaluate("JSON.parse(localStorage.getItem('rovya-agenda-pendentes'))") == [], 'fila vazia depois de enviar')
    ok('conflito' in pg.inner_text('#toast'), 'toast fala do conflito: ' + pg.inner_text('#toast'))
    pg.wait_for_timeout(800)
    ok(pg.locator('.ev.pendente').count() == 0 and pg.locator('.ev', has_text='Reunião Clínica Dias').count() == 1, 'agenda recarregou sem pendentes e com o criado')
    pg.screenshot(path=os.path.join(S, 't6_agenda_online.png'))

    # 6) reenviar não duplica: força a fila com um evento que já está no Google
    pg.evaluate("localStorage.setItem('rovya-agenda-pendentes', JSON.stringify([{ evento: window.__ev.find(e => e.acao === 'criar').evento }]))")
    pg.evaluate('window.__ev.length = 0'); pg.evaluate("dispatchEvent(new Event('online'))"); pg.wait_for_timeout(1500)
    ok(not any(e['acao'] == 'criar' for e in pg.evaluate('window.__ev')), 'compromisso já criado não é criado de novo')

    # 7) estrutura do Drive: editar, remover, adicionar; 07 protegida
    pg.set_viewport_size({'width': 1400, 'height': 900})
    pg.goto(base + '#/documentos'); pg.wait_for_selector('#editEstr')
    ok(pg.locator('[data-tirar]').count() == 0, 'sem botões de remover fora do modo edição')
    ok('16 — Área 16 · ainda não criada no Drive' in pg.inner_text('main'), 'área sem pasta aparece como "ainda não criada"')
    pg.click('#editEstr'); pg.wait_for_selector('[data-tirar]')
    ok(pg.locator('[data-tirar="07"]').count() == 0 and pg.locator('[data-tirar="15"]').count() == 0 and pg.locator('[data-tirar]').count() == 16,
       '07 (clientes) e 15 (backups) não podem ser removidas; as outras 16 sim')
    pg.screenshot(path=os.path.join(S, 't6_drive_editar.png'))
    pg.evaluate('window.__log.length = 0')
    pg.click('[data-tirar="03"]'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    log = pg.evaluate('window.__log')
    ok(['crm_drive', 'delete', []] in log and ['crm_drive', 'eq', ['chave', '03']] in log, 'remover apaga só a linha 03')
    pg.click('#novaArea'); pg.wait_for_selector('#dlg[open]')
    ok('18 — …' in pg.inner_text('#dlgf'), 'próximo código sugerido: 18')
    pg.evaluate('window.__log.length = 0')
    pg.fill('#dlgf [name=nome]', 'Parcerias'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ins = [a[0] for t, k, a in pg.evaluate('window.__log') if t == 'crm_drive' and k == 'insert']
    ok(ins == [{'chave': '18', 'nome': '18 — Parcerias'}], f'adicionar grava 18 — Parcerias: {ins}')
    pg.click('#editEstr'); pg.wait_for_timeout(300)
    ok(pg.locator('[data-tirar]').count() == 0, '"Concluir" sai do modo edição')

    # 8) telas principais continuam abrindo
    for r in ['', 'clientes', 'projetos', 'financeiro', 'tarefas', 'configuracoes', 'cliente/c1']:
        pg.goto(base + '#/' + r); pg.wait_for_timeout(600)
        if 'Não consegui carregar' in pg.inner_text('main'): erros.append('falhou ' + r)
    b.close()
print('ERROS:', erros or 'nenhum')
sys.exit(1 if erros else 0)
