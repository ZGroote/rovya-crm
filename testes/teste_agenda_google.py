# Agenda e Google (mock): agenda pessoal x profissional, Meet + convite, reservas para novos clientes,
# compromissos antigos ligados ao cliente, e-mail pelo Gmail com anexo, importar contatos do Google, aviso de reconectar.
import os, sys, json
from playwright.sync_api import sync_playwright
S = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'saida'); os.makedirs(S, exist_ok=True)
base = 'http://localhost:8777/_mock.html'
erros = []
def ok(cond, msg):
    print(('OK   ' if cond else 'FALHA'), msg)
    if not cond: erros.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch(executable_path=r'C:\Program Files\Google\Chrome\Application\chrome.exe')
    ctx = b.new_context(viewport={'width': 1300, 'height': 900})
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: erros.append('pageerror: ' + str(e)))
    ev = lambda acao: [e for e in pg.evaluate('window.__ev') if e['acao'] == acao]
    pg.goto(base + '#/agenda'); pg.wait_for_selector('#nEv')
    amanha = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv'); })()")
    mais3sem = pg.evaluate("(() => { const d = new Date(); d.setDate(d.getDate() + 21); return d.toLocaleDateString('sv'); })()")

    # 1) agendas: sem pessoal, o formulário não pergunta; cria a "Pessoal" pelo CRM
    pg.click('#nEv'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=agenda]').count() == 0, 'sem agenda pessoal escolhida, o formulário não pergunta a agenda')
    pg.click('#dlgf button[value=cancelar]')
    pg.click('#cfgAg'); pg.wait_for_selector('#dlg[open]')
    pg.select_option('#dlgf [name=pessoal]', '+'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(600)
    sa = ev('salvar_agendas')
    ok(len(ev('criar_agenda')) == 1 and sa and sa[-1]['agendas']['pessoal'] == 'pes1' and sa[-1]['agendas']['profissional'] == 'rovyacreative@gmail.com', 'cria a agenda “Pessoal” no Google e salva a escolha')

    # 2) compromisso pessoal... e reunião profissional com Meet + convite ao cliente
    pg.wait_for_selector('#nEv'); pg.click('#nEv'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=agenda]').count() == 1, 'com pessoal escolhida, o formulário pergunta a agenda')
    pg.fill('#dlgf [name=titulo]', 'Pilates'); pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', '07:00')
    pg.select_option('#dlgf [name=agenda]', 'pessoal'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(600)
    c = ev('criar')[-1]
    ok(c['agenda'] == 'pessoal' and 'conferenceData' not in c['evento'] and 'attendees' not in c['evento'], 'compromisso pessoal vai para a agenda pessoal, sem Meet nem convite')
    pg.wait_for_selector('#nEv'); pg.click('#nEv'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=titulo]', 'Reunião Horizonte'); pg.select_option('#dlgf [name=cliente_id]', 'c1')
    pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', '11:00')
    pg.select_option('#dlgf [name=meet]', '1'); pg.select_option('#dlgf [name=convidar]', '1'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(700)
    c = ev('criar')[-1]
    ok(c['agenda'] == 'profissional' and c['evento']['conferenceData']['createRequest']['conferenceSolutionKey']['type'] == 'hangoutsMeet', 'reunião profissional com link do Meet')
    ok(c['evento'].get('attendees') == [{'email': 'paulo@horizonte.com'}], 'cliente convidado pelo e-mail dele')
    ok('convite enviado' in pg.inner_text('#toast'), 'aviso diz que o convite foi enviado')
    pg.wait_for_selector('.ev.t-pessoal')
    ok(pg.locator('.ev.t-pessoal', has_text='Pilates').count() == 1 and pg.locator('.ev', has_text='Reunião Horizonte').locator('[data-meet]').count() == 1, 'agenda mostra o pessoal marcado e o link do Meet')
    pg.click('#agFiltro [data-filtro=profissional]')
    ok(pg.locator('.ev', has_text='Pilates').is_hidden() and pg.locator('.ev', has_text='Reunião Horizonte').is_visible(), 'filtro “Profissional” esconde o pessoal')
    pg.click('#agFiltro [data-filtro=pessoal]')
    ok(pg.locator('.ev', has_text='Pilates').is_visible() and pg.locator('.ev', has_text='Reunião Horizonte').is_hidden(), 'filtro “Pessoal” mostra só o pessoal')
    pg.click('#agFiltro [data-filtro=""]')

    # 3) reservar horário para novos clientes: 1 hora fixa; sem data = toda semana; mesmo dia = só ele; data = até lá
    pg.click('#reservar'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf [name=dur], #dlgf [name=fim]').count() == 0, 'não pede duração nem horário final')
    pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', '14:00')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(600)
    r = ev('criar')[-1]['evento']
    ok(r['extendedProperties']['private'] == {'crm_reserva': '1', 'crm_slot': '60'} and r['transparency'] == 'transparent', 'reserva marcada como livre, conversa de 1 hora')
    ok(r['start'] == {'dateTime': amanha + 'T14:00:00', 'timeZone': 'America/Sao_Paulo'} and r['end'] == {'dateTime': amanha + 'T15:00:00', 'timeZone': 'America/Sao_Paulo'}, '14h vai até as 15h sozinho')
    ok(r['recurrence'] == ['RRULE:FREQ=WEEKLY'], 'sem data de repetição: toda semana, sem fim')
    ok('toda semana' in pg.inner_text('#toast'), 'aviso diz que repete toda semana')
    pg.wait_for_selector('.ev.reserva')
    ok('aberto para agendamentos pelo site' in pg.inner_text('.ev.reserva'), 'reserva aparece diferente na agenda')
    pg.screenshot(path=os.path.join(S, 'ag_agenda.png'), full_page=True)
    pg.click('.ev.reserva'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf button[value=um]').count() == 1, 'clicar na reserva oferece tirar')
    pg.click('#dlgf button[value=um]'); pg.wait_for_timeout(500)
    ok(len(ev('apagar')) == 1, 'tirar a reserva apaga do Google')
    pg.click('#reservar'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', '09:30'); pg.fill('#dlgf [name=ate]', amanha); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    r = ev('criar')[-1]['evento']
    ok('recurrence' not in r and r['end']['dateTime'] == amanha + 'T10:30:00', 'mesmo dia na repetição: só esse dia (9h30 → 10h30)')
    pg.click('#reservar'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=data]', amanha); pg.fill('#dlgf [name=hora]', '19:00'); pg.fill('#dlgf [name=ate]', mais3sem); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ok(ev('criar')[-1]['evento']['recurrence'] == ['RRULE:FREQ=WEEKLY;UNTIL=' + mais3sem.replace('-', '') + 'T235959Z'], 'com data: toda semana até ela')
    pg.click('#reservar'); pg.wait_for_selector('#dlg[open]')
    pg.fill('#dlgf [name=hora]', '23:30'); n = len(ev('criar'))
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(400)
    ok(len(ev('criar')) == n and 'meia-noite' in pg.inner_text('#toast'), 'depois das 23h não cria (passaria da meia-noite)')

    # 4) compromissos antigos ligados ao cliente: pelo nome no título e pelo e-mail do convidado
    pg.evaluate(f"""window.__EV.eventos.push(
      {{ id: 'g8', summary: 'Café com paulo mendes', start: {{ dateTime: '{amanha}T09:00:00-03:00' }}, end: {{ dateTime: '{amanha}T09:30:00-03:00' }} }},
      {{ id: 'g7', summary: 'Call', attendees: [{{ email: 'MARINA@atelie.com' }}], start: {{ dateTime: '{amanha}T17:00:00-03:00' }}, end: {{ dateTime: '{amanha}T17:30:00-03:00' }} }},
      {{ id: 'g6', summary: 'Paulo dentista', start: {{ dateTime: '{amanha}T18:00:00-03:00' }}, end: {{ dateTime: '{amanha}T18:30:00-03:00' }} }})""")
    pg.goto(base + '#/clientes'); pg.goto(base + '#/agenda'); pg.wait_for_selector('.ev[data-ev=g8]')
    ok('Paulo Mendes' in pg.inner_text('.ev[data-ev=g8]') and 'crm' in pg.get_attribute('.ev[data-ev=g8]', 'class'), 'evento com o nome do cliente no título fica ligado a ele')
    ok('Marina Lopes' in pg.inner_text('.ev[data-ev=g7]'), 'evento com o cliente convidado fica ligado a ele')
    ok('crm' not in pg.get_attribute('.ev[data-ev=g6]', 'class'), 'só o primeiro nome não liga (evita engano)')
    pg.goto(base + '#/cliente/c1'); pg.wait_for_selector('#cEventos li', timeout=8000)
    t = pg.inner_text('#cEventos')
    ok('Café com paulo mendes' in t and 'Reunião Horizonte' in t and 'Paulo dentista' not in t, 'ficha do cliente lista os compromissos dele')

    # 5) e-mail pelo Gmail com anexo, registrado no histórico
    pg.evaluate('window.__log.length = 0')
    pg.click('#emailG'); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=para]') == 'paulo@horizonte.com', 'e-mail já vem com o endereço do cliente')
    pg.fill('#dlgf [name=assunto]', 'Proposta Horizonte'); pg.fill('#dlgf [name=texto]', 'Olá, Paulo! Segue a proposta.')
    pg.set_input_files('#anexosEmail', files=[{'name': 'proposta.pdf', 'mimeType': 'application/pdf', 'buffer': b'%PDF-1.4 teste'}])
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(800)
    m = ev('email')
    ok(m and m[-1]['para'] == 'paulo@horizonte.com' and m[-1]['anexos'][0]['nome'] == 'proposta.pdf' and m[-1]['anexos'][0]['base64'] == 'JVBERi0xLjQgdGVzdGU=', 'e-mail sai com o anexo em base64')
    hist = [a[0] for t2, k, a in pg.evaluate('window.__log') if t2 == 'crm_interacoes' and k == 'insert']
    ok(hist and hist[0]['tipo'] == 'email' and 'Proposta Horizonte' in hist[0]['resumo'] and '(1 anexo)' in hist[0]['resumo'], 'e-mail registrado no histórico do cliente')

    # 6) importar contatos do Google: só os novos, com filtro
    pg.goto(base + '#/clientes'); pg.wait_for_selector('#impG'); pg.evaluate('window.__log.length = 0')
    pg.click('#impG'); pg.wait_for_selector('#listaCont')
    nomes = pg.locator('#listaCont label').all_inner_texts()
    ok(len(nomes) == 3 and not any('Paulo' in x for x in nomes), f'mostra só os contatos que não estão no CRM ({len(nomes)})')
    pg.fill('#filtroCont', 'souza'); pg.check('#todosCont')
    ok(pg.locator('#listaCont [data-cont]:checked').count() == 1, '“marcar todos” marca só os filtrados')
    pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(600)
    ins = [a[0] for t2, k, a in pg.evaluate('window.__log') if t2 == 'crm_clientes' and k == 'insert']
    ok(ins and ins[0] == [{'nome': 'Lia Souza', 'email': 'lia@souza.com', 'telefone': None, 'empresa': 'Souza Arquitetura', 'origem': 'Contatos do Google'}], 'importa o contato marcado como cliente')

    # 7) conexão antiga (sem as permissões novas): aviso para reconectar
    pg.evaluate("window.__EV.faltam = ['gmail.send']")
    pg.goto(base + '#/agenda'); pg.wait_for_selector('#recon')
    ok('Reconectar' in pg.inner_text('#agAviso'), 'conexão sem as permissões novas mostra “Reconectar Google”')
    pg.screenshot(path=os.path.join(S, 'ag_reconectar.png'))
    b.close()
print('ERROS:', erros or 'nenhum'); sys.exit(1 if erros else 0)
