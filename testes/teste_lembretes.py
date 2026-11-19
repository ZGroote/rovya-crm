# Lembrete nas tarefas (dia e hora no fuso do aparelho → instante no banco), o 🔔 na lista, o botão de ativar notificações em Tarefas,
# e o login renovado antes de chamar as funções (sem anotar "Sem permissão" quando o login venceu há segundos).
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 1440, 'height': 900}, timezone_id='America/Sao_Paulo'); pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))
    log = lambda t, k: [a for tt, kk, a in pg.evaluate('window.__log') if tt == t and kk == k]
    pg.goto('http://localhost:8777/_mock.html#/tarefas'); pg.wait_for_selector('.lista li[data-tarefa]')
    pg.wait_for_selector('#avisos #bNotif', timeout=5000)
    ok('Ativar notificações' in pg.inner_text('#avisos'), 'Tarefas mostra o botão de ativar notificações neste aparelho')
    # nova tarefa com lembrete às 14:30 de Brasília = 17:30 UTC
    pg.evaluate('window.__log.length = 0'); pg.click('#nTarefa'); pg.wait_for_selector('#dlg[open]')
    ok(pg.get_attribute('#dlgf [name=lembrete]', 'type') == 'datetime-local', 'campo de lembrete com dia e hora')
    pg.fill('#dlgf [name=titulo]', 'Ligar para a Marina'); pg.fill('#dlgf [name=lembrete]', '2026-11-20T14:30')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ins = log('crm_tarefas', 'insert'); d = ins and (ins[0][0][0] if isinstance(ins[0][0], list) else ins[0][0])
    ok(d and d.get('lembrete') == '2026-11-20T17:30:00.000Z', f'grava o instante certo (14:30 de Brasília = 17:30 UTC): {d and d.get("lembrete")}')
    pg.evaluate('window.__log.length = 0'); pg.click('#nTarefa'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Sem lembrete'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ins = log('crm_tarefas', 'insert'); d = ins and (ins[0][0][0] if isinstance(ins[0][0], list) else ins[0][0])
    ok(d and d.get('lembrete') is None, 'sem lembrete: fica vazio')
    # na lista: 🔔 com a hora local; editar devolve o mesmo dia e hora
    pg.evaluate("window.__D.crm_tarefas[0].lembrete = '2026-11-20T17:30:00+00:00'; window.__D.crm_tarefas[0].lembrete_enviado = null; location.hash = '#/funil'; setTimeout(() => location.hash = '#/tarefas', 300)")
    pg.wait_for_timeout(900); pg.screenshot(path='testes/saida/lembretes.png')
    ok(pg.locator('h1').inner_text() == 'Tarefas' and '🔔 20/11, 14:30' in pg.inner_text('.lista li[data-tarefa="t1"]'), 'lista mostra 🔔 20/11, 14:30')
    pg.click('.lista li[data-tarefa="t1"] b'); pg.wait_for_selector('#dlg[open]'); pg.screenshot(path='testes/saida/lembretes_form.png')
    ok(pg.input_value('#dlgf [name=lembrete]') == '2026-11-20T14:30', f'editar abre com o lembrete na hora local: {pg.input_value("#dlgf [name=lembrete]")}')
    pg.keyboard.press('Escape'); pg.wait_for_timeout(200)
    pg.evaluate("window.__D.crm_tarefas[0].lembrete_enviado = '2026-11-20T17:30:00+00:00'; location.hash = '#/funil'; setTimeout(() => location.hash = '#/tarefas', 300)"); pg.wait_for_timeout(900)
    ok('🔔' not in pg.inner_text('.lista li[data-tarefa="t1"]'), 'já avisado: o 🔔 some da lista')
    # login: vencendo em segundos → renova antes; 401 → renova e tenta de novo, sem anotar falha
    r = pg.evaluate("""async () => {
      const cfg = await import('/_mock/config.js'), u = await import('/util.js');
      let renovou = 0, chamadas = [], primeira = true;
      cfg.sb.auth.refreshSession = async () => { renovou++; return { data: { session: { access_token: 'novo', expires_at: Date.now() / 1000 + 3600 } } }; };
      cfg.sb.auth.getSession = async () => ({ data: { session: { access_token: 'velho', expires_at: Date.now() / 1000 + 10 } } });
      const f0 = window.fetch;
      window.fetch = (url, o) => { if (String(url).includes('functions/v1')) { chamadas.push(o.headers.Authorization); if (primeira) { primeira = false; return Promise.resolve(new Response('{"erro":"Sem permissão"}', { status: 401 })); } } return f0(url, o); };
      window.__log.length = 0;
      await u.funcao('crm-google', 'listar', {}); await new Promise(r => setTimeout(r, 200));
      const falhas = window.__log.filter(([t, k]) => t === 'crm_falhas' && k === 'insert').length;
      window.fetch = f0; return { renovou, chamadas, falhas };
    }""")
    ok(r['chamadas'] == ['Bearer novo', 'Bearer novo'] and r['renovou'] == 2, f'login vencendo: renova antes e, com 401, renova e tenta de novo: {r}')
    ok(r['falhas'] == 0, 'deu certo na segunda: não anota "Sem permissão"')
    ctx.close(); b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
