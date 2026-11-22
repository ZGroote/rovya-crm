# Ajustes pedidos pela Sabrina (22/11/2026): código de serviço repetido, apagar oportunidade,
# selecionar várias peças na Produção (apagar / mover) e apagar peça leva os arquivos junto.
import sys
from playwright.sync_api import sync_playwright
erros = []
def ok(c, m):
    print(('OK   ' if c else 'FALHA'), m)
    if not c: erros.append(m)
U = 'http://localhost:8777/_mock.html'
log = lambda pg, t, k: pg.evaluate(f"window.__log.filter(([t, k]) => t === '{t}' && k === '{k}').map(x => x[2])")
with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    pg = b.new_page(viewport={'width': 1300, 'height': 900})
    pg.on('pageerror', lambda e: erros.append('pageerror ' + str(e)))

    # 1) serviço com código repetido: aviso no formulário, que continua aberto
    pg.goto(U + '#/servicos'); pg.wait_for_selector('#nServ')
    pg.click('#nServ'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=codigo]', 'SV02'); pg.fill('#dlgf [name=nome]', 'Social media'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_selector('#dlgf .atrasado')
    ok('Já existe um serviço com o código SV02 (Identidade visual). Use outro, por exemplo' in pg.inner_text('#dlgf .atrasado'), 'código repetido: explica e sugere outro')
    ok(pg.input_value('#dlgf [name=nome]') == 'Social media' and not log(pg, 'crm_servicos', 'insert'), 'não perde o que ela digitou e não tenta gravar')
    pg.fill('#dlgf [name=codigo]', '11'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ins = log(pg, 'crm_servicos', 'insert')
    ok(ins and ins[-1][0]['codigo'] == '11' and ins[-1][0]['nome'] == 'Social media', 'com código livre, salva')

    # 2) apagar oportunidade no funil
    pg.goto(U + '#/funil'); pg.wait_for_selector('.op[data-id=o4]')
    pg.click('.op[data-id=o4]'); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlgf button[value=apagar]'); pg.wait_for_selector('#dlg[open]')
    ok('Perdido' in pg.inner_text('#dlgf'), 'confirmação lembra que "Perdido" guarda o motivo')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(300)
    ok(pg.evaluate("window.__log.some(([t, k]) => t === 'crm_oportunidades' && k === 'delete') && window.__log.some(([t, k, a]) => t === 'crm_oportunidades' && k === 'eq' && a[1] === 'o4')"), 'apaga a oportunidade')

    # 3) Produção: selecionar várias, marcar todos, mover e apagar
    pg.goto(U + '#/producao'); pg.wait_for_selector('#selecionar')
    ok(pg.get_attribute('.op', 'draggable') == 'true' and pg.locator('.op .marca').count() == 0, 'fora do modo Selecionar: arrastar e abrir como antes')
    pg.click('#selecionar'); pg.wait_for_selector('.barra-sel')
    ok(pg.is_disabled('#apagarSel') and pg.inner_text('#nSel') == '0 peças selecionadas', 'modo Selecionar: barra começa sem nada marcado')
    ids = pg.evaluate("[...document.querySelectorAll('.col[data-status=a_fazer] .op')].map(e => e.dataset.id)")
    pg.click(f'.op[data-id="{ids[0]}"]'); pg.click(f'.op[data-id="{ids[1]}"]')
    ok(pg.inner_text('#nSel') == '2 peças selecionadas' and pg.locator('.op.marcada').count() == 2 and not pg.is_visible('#dlg[open]'), 'clicar marca (não abre a peça)')
    pg.click(f'.op[data-id="{ids[1]}"]'); ok(pg.inner_text('#nSel') == '1 peça selecionada', 'clicar de novo desmarca')
    pg.click('[data-todos=a_fazer]')
    ok(pg.inner_text('#nSel') == f'{len(ids)} peças selecionadas' and pg.inner_text('[data-todos=a_fazer]') == 'Desmarcar', 'marcar todos da coluna: ' + str(len(ids)))
    pg.click('[data-todos=a_fazer]'); ok(pg.inner_text('#nSel') == '0 peças selecionadas', 'desmarcar todos')
    pg.click('[data-todos=a_fazer]')
    pg.click('#apagarSel'); pg.wait_for_selector('#dlg[open]')
    ok(f'Apagar {len(ids)} peças? Os arquivos delas também são apagados' in pg.inner_text('#dlgf'), 'pede confirmação com o número de peças')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(200)
    ok(not log(pg, 'crm_entregas', 'delete') and pg.inner_text('#nSel') == f'{len(ids)} peças selecionadas', 'desistiu: nada apagado, seleção continua')
    pg.click('#apagarSel'); pg.wait_for_selector('#dlg[open]'); pg.click('#dlgf button[value=ok]'); pg.wait_for_selector('#selecionar')
    ins_ids = pg.evaluate("window.__log.filter(([t, k]) => t === 'crm_entregas' && k === 'in').map(x => x[2][1]).at(-1)")
    ok(log(pg, 'crm_entregas', 'delete') and sorted(ins_ids) == sorted(ids), 'apaga só as selecionadas, numa gravação')
    ok(pg.evaluate("window.__log.some(([t, k, a]) => t === 'crm_anexos' && k === 'in' && a[0] === 'entrega_id')"), 'busca os arquivos das peças para apagar do servidor')
    pg.click('#selecionar'); pg.wait_for_selector('.barra-sel')
    pg.click('.col[data-status=enviado] .op'); pg.select_option('#moverPara', 'aprovado'); pg.wait_for_selector('#selecionar')
    up = log(pg, 'crm_entregas', 'update')
    ok(up and up[-1][0]['status'] == 'aprovado', 'mover selecionadas para outro status')
    pg.click('#selecionar'); pg.wait_for_selector('#sairSel'); pg.click('#sairSel'); pg.wait_for_selector('#selecionar')
    ok(pg.locator('.barra-sel').count() == 0, 'cancelar sai do modo Selecionar')

    # 4) apagar uma peça pela ficha: arquivos junto
    pg.evaluate('window.__log.length = 0')
    pg.click('.col[data-status=a_fazer] .op'); pg.wait_for_selector('#dlg[open]')
    pg.click('#dlgf button[value=apagar]'); pg.wait_for_selector('#dlg[open]')
    ok('arquivos dela também' in pg.inner_text('#dlgf'), 'apagar uma peça avisa que os arquivos vão junto')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    ok(pg.evaluate("window.__log.some(([t, k, a]) => t === 'crm_anexos' && k === 'in') && window.__log.some(([t, k]) => t === 'crm_entregas' && k === 'delete')"), 'apaga a peça e procura os arquivos dela')

    # 5) resposta a dado errado (ex.: e-mail de admin no portal) não vira "falha de integração"; defeito do servidor vira
    r = pg.evaluate("""async () => { const { funcao } = await import('./util.js'); const f0 = window.fetch, res = [];
      for (const st of [400, 409, 500]) {
        window.fetch = () => Promise.resolve(new Response(JSON.stringify({ erro: 'resposta ' + st }), { status: st }));
        window.__log.length = 0; try { await funcao('crm-portal', 'convidar'); } catch (e) { }
        res.push(window.__log.some(([t, k]) => t === 'crm_falhas' && k === 'insert')); }
      window.fetch = f0; return res; }""")
    ok(r == [False, False, True], 'Falhas de integração: 400 e 409 não entram, 500 entra: ' + str(r))
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
