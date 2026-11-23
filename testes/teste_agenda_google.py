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

    # 3) horários da semana: pinta Rovya / Pessoal / BNI; horas seguidas viram um evento só; repete toda semana; tirar
    pg.click('#reservar'); pg.wait_for_selector('#hGrade')
    ok(pg.locator('#nav a.on').inner_text().strip().endswith('Agenda'), 'Horários da semana fica dentro de Agenda')
    agora_h = pg.evaluate('new Date().getHours()'); hj = pg.evaluate("new Date().toLocaleDateString('sv')")
    if agora_h >= 7: ok(pg.locator(f'#hGrade .sc[data-k="{hj}|6"]').is_disabled(), 'hora que já passou não dá para marcar')
    seg = pg.evaluate("(() => { const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - (d.getDay() + 6) % 7 + 7); return d.toLocaleDateString('sv'); })()")
    ter = pg.evaluate(f"(() => {{ const d = new Date('{seg}T12:00'); d.setDate(d.getDate() + 1); return d.toLocaleDateString('sv'); }})()")
    pg.evaluate(f"window.__EV.eventos.push({{ id: 'g5', summary: 'Reunião Horizonte', start: {{ dateTime: '{ter}T10:00:00-03:00' }}, end: {{ dateTime: '{ter}T11:30:00-03:00' }} }})")
    pg.click('.h-nav a[aria-label="Próxima semana"]'); pg.wait_for_selector(f'#hGrade .sc[data-k="{seg}|9"]')
    cel = lambda d, h: f'#hGrade .sc[data-k="{d}|{h}"]'
    ok('k-ocupado' in pg.get_attribute(cel(ter, 10), 'class') and 'k-ocupado' in pg.get_attribute(cel(ter, 11), 'class') and pg.inner_text(cel(ter, 10)) == 'Reunião Horizonte', 'compromisso da agenda aparece ocupado (10h e 11h)')
    n0 = len(ev('criar'))
    pg.hover(cel(seg, 9)); pg.mouse.down(); pg.hover(cel(seg, 10)); pg.mouse.up()   # arrastar: 9h e 10h
    pg.click(cel(seg, 14))
    pg.click('[data-modo=bni]'); pg.click(cel(ter, 7))
    pg.click('[data-modo=pessoal]'); pg.click(cel(ter, 18)); pg.click(cel(ter, 18)); pg.click(cel(ter, 19))   # tocar de novo desmarca
    pg.click(cel(ter, 10)); pg.wait_for_selector('#dlg[open]')
    ok('k-ocupado' in pg.get_attribute(cel(ter, 10), 'class') and pg.input_value('#dlgf [name=titulo]') == 'Reunião Horizonte', 'tocar num compromisso não marca por cima: abre para mudar')
    pg.click('#dlgf button[value=cancelar]'); pg.wait_for_timeout(200)
    ok(pg.inner_text('#hConta') == '5 hora(s) para salvar', f'conta as horas marcadas: {pg.inner_text("#hConta")}')
    pg.screenshot(path=os.path.join(S, 'ag_horarios.png'), full_page=True)
    ok(not pg.is_checked('#hRep'), 'repetir vem desmarcado')
    pg.check('#hRep'); pg.click('#hSalvar'); pg.wait_for_selector(cel(seg, 9) + '.k-rovya:not(.novo)')
    cs = ev('criar')[n0:]; tz = 'America/Sao_Paulo'
    ok(len(cs) == 4, f'horas seguidas viram um evento só: {len(cs)} eventos')
    r = cs[0]['evento']
    ok(r['start'] == {'dateTime': seg + 'T09:00:00', 'timeZone': tz} and r['end'] == {'dateTime': seg + 'T11:00:00', 'timeZone': tz}, 'Rovya 9h e 10h → um período 9h–11h')
    ok(r['extendedProperties']['private'] == {'crm_reserva': '1', 'crm_slot': '60'} and r['transparency'] == 'transparent' and cs[0]['agenda'] == 'profissional', 'Rovya: livre, conversas de 1 hora, na agenda profissional (o site oferece)')
    ok(all('recurrence' not in c['evento'] for c in cs[:2]) and all(c['evento'].get('recurrence') == ['RRULE:FREQ=WEEKLY'] for c in cs[2:]), 'repetir: Pessoal e BNI toda semana; Rovya nunca (só esta semana)')
    bni = cs[2]
    ok(bni['evento']['summary'] == 'BNI' and bni['evento']['extendedProperties']['private'] == {'crm_bloco': 'bni'} and 'transparency' not in bni['evento'] and bni['agenda'] == 'profissional', 'BNI: ocupa o horário (o site não oferece), na profissional')
    pes = cs[3]
    ok(pes['evento']['summary'] == 'Pessoal' and pes['agenda'] == 'pessoal' and pes['evento']['start']['dateTime'] == ter + 'T19:00:00', 'Pessoal: na agenda pessoal, só o horário que ficou marcado')
    ok('k-bni' in pg.get_attribute(cel(ter, 7), 'class') and 'k-pessoal' in pg.get_attribute(cel(ter, 19), 'class') and 'k-pessoal' not in pg.get_attribute(cel(ter, 18), 'class'), 'depois de salvar, a semana mostra o que ficou')
    # só esta semana
    pg.uncheck('#hRep'); pg.click(cel(seg, 16)); pg.click('#hSalvar'); pg.wait_for_selector(cel(seg, 16) + '.k-rovya:not(.novo)')
    ok('recurrence' not in ev('criar')[-1]['evento'], 'sem “repetir”: só aquele dia')
    # tirar
    n = len(ev('apagar')); pg.click(cel(ter, 7)); pg.wait_for_selector('#dlg[open]')
    ok('BNI' in pg.inner_text('#dlgf h2') and pg.locator('#dlgf button[value=um]').count() == 1, 'tocar num horário marcado oferece tirar')
    pg.click('#dlgf button[value=um]'); pg.wait_for_timeout(500)
    ok(len(ev('apagar')) == n + 1 and ev('apagar')[-1]['agenda'] == 'profissional', 'tirar apaga do Google')
    # Apagar: ligado, cada toque tira só aquela hora, e só da categoria escolhida
    pg.click('[data-modo=bni]'); pg.click(cel(seg, 18)); pg.click(cel(seg, 19)); pg.click(cel(seg, 20)); pg.click('#hSalvar'); pg.wait_for_selector(cel(seg, 20) + '.k-bni:not(.novo)')
    pg.click('[data-modo=rovya]'); pg.click('#hApagar')
    ok(pg.get_attribute('#hApagar', 'aria-pressed') == 'true' and 'lixeira' in pg.get_attribute('#hGrade', 'class'), 'Apagar liga e o cursor vira lixeira')
    ok('svg' in pg.evaluate("getComputedStyle(document.querySelector('#hGrade .sc:not(:disabled)')).cursor"), 'cursor de lixeira nos horários')
    ne, na = len(ev('editar')), len(ev('apagar'))
    pg.click(cel(seg, 19)); pg.wait_for_timeout(300)
    ok('é BNI' in pg.inner_text('#toast') and len(ev('editar')) == ne and len(ev('apagar')) == na, 'com Rovya escolhido, tocar no BNI não apaga')
    pg.click('[data-modo=bni]'); nc = len(ev('criar')); pg.click(cel(seg, 19)); pg.wait_for_selector(cel(seg, 19) + ':not(.k-bni)')
    ok(len(ev('editar')) == ne + 1 and len(ev('criar')) == nc + 1, 'tirar a hora do meio divide o bloco em dois')
    ok('k-bni' in pg.get_attribute(cel(seg, 18), 'class') and 'k-bni' in pg.get_attribute(cel(seg, 20), 'class'), 'ficam 18h e 20h')
    ok(pg.get_attribute('#hApagar', 'aria-pressed') == 'true' and 'ativo' in pg.get_attribute('[data-modo=bni]', 'class'), 'Apagar e a categoria continuam escolhidos depois de tirar')
    pg.click(cel(seg, 20)); pg.wait_for_selector(cel(seg, 20) + ':not(.k-bni)')
    ok(len(ev('apagar')) == na + 1, 'bloco de 1 hora: apaga o evento')
    pg.screenshot(path=os.path.join(S, 'ag_horarios_apagar.png'), full_page=True)
    pg.click('#hApagar')
    # Compromisso: cria, muda e apaga reunião de verdade no Google pela grade
    pg.click('[data-modo=compromisso]'); pg.click(cel(seg, 7)); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=data]') == seg and pg.input_value('#dlgf [name=hora]') == '07:00', 'compromisso: formulário já vem com o dia e a hora tocados')
    nc = len(ev('criar')); pg.fill('#dlgf [name=titulo]', 'Café com a Joana'); pg.click('#dlgf button[value=ok]'); pg.wait_for_selector(cel(seg, 7) + '.k-ocupado')
    ok(len(ev('criar')) == nc + 1 and ev('criar')[-1]['evento']['summary'] == 'Café com a Joana' and 'Café com a Joana' in pg.inner_text(cel(seg, 7)), 'compromisso criado no Google e aparece na grade')
    pg.click(cel(ter, 10)); pg.wait_for_selector('#dlg[open]')
    ok(pg.input_value('#dlgf [name=titulo]') == 'Reunião Horizonte' and pg.locator('#dlgf button[value=apagar]').count() == 1, 'tocar num compromisso abre para mudar ou apagar')
    ne = len(ev('editar')); pg.fill('#dlgf [name=titulo]', 'Reunião Horizonte (mudou)'); pg.click('#dlgf button[value=ok]'); pg.wait_for_timeout(500)
    ok(len(ev('editar')) == ne + 1 and ev('editar')[-1]['evento']['summary'] == 'Reunião Horizonte (mudou)', 'mudança vai direto para o Google')
    pg.click('#hApagar'); pg.click('[data-modo=rovya]'); pg.click(cel(seg, 7)); pg.wait_for_timeout(200)
    ok('escolha Compromisso' in pg.inner_text('#toast') and pg.locator('#dlg[open]').count() == 0, 'Apagar com Rovya escolhido não mexe em compromisso')
    pg.click('[data-modo=compromisso]'); na = len(ev('apagar')); pg.click(cel(seg, 7)); pg.wait_for_selector('#dlg[open]'); pg.click('#dlgf button[value=ok]')
    pg.wait_for_selector(cel(seg, 7) + ':not(.k-ocupado)')
    ok(len(ev('apagar')) == na + 1, 'Apagar com Compromisso escolhido apaga do Google (com confirmação)')
    pg.click('#hApagar')
    # Liberar vagos: toda hora livre da semana vira Rovya (confere e salva); o que já tem algo fica como está
    pg.click('#hVagos'); pg.wait_for_timeout(200)
    ok('novo' in pg.get_attribute(cel(seg, 6), 'class') and 'k-rovya' in pg.get_attribute(cel(seg, 22), 'class'), 'vagos: 6h e 22h viram Rovya (grade vai até 23h)')
    ok('k-ocupado' in pg.get_attribute(cel(ter, 10), 'class') and 'k-bni' in pg.get_attribute(cel(seg, 18), 'class') and 'novo' not in pg.get_attribute(cel(seg, 18), 'class'), 'vagos: compromisso e BNI ficam como estão')
    pg.click(cel(seg, 7)); ok('novo' not in pg.get_attribute(cel(seg, 7), 'class'), 'tocar num vago marcado desmarca')
    nc = len(ev('criar')); pg.click('#hSalvar'); pg.wait_for_selector(cel(seg, 6) + '.k-rovya:not(.novo)')
    vs = [c['evento'] for c in ev('criar')[nc:] if c['evento']['start']['dateTime'].startswith(seg)]
    ok(any(v['start']['dateTime'] == seg + 'T06:00:00' and v['end']['dateTime'] == seg + 'T07:00:00' for v in vs) and any(v['end']['dateTime'] == seg + 'T23:00:00' for v in vs), 'vagos salvos em períodos (6h–7h … até 23h)')
    ok(all('recurrence' not in v and v['extendedProperties']['private'].get('crm_reserva') == '1' for v in vs), 'vagos: Rovya, só esta semana')
    pg.set_viewport_size({'width': 390, 'height': 844}); pg.wait_for_timeout(200)
    ok(pg.evaluate('document.documentElement.scrollWidth <= innerWidth'), 'no celular, a semana cabe sem rolar para o lado')
    pg.screenshot(path=os.path.join(S, 'ag_horarios_cel.png'), full_page=True)
    pg.set_viewport_size({'width': 1300, 'height': 900})
    # na lista da Agenda, a reserva aparece diferente e abre o "tirar"
    pg.evaluate(f"window.__EV.eventos.push({{ id: 'r1', summary: 'Reservado · novos clientes', transparency: 'transparent', start: {{ dateTime: '{amanha}T14:00:00-03:00' }}, end: {{ dateTime: '{amanha}T15:00:00-03:00' }}, extendedProperties: {{ private: {{ crm_reserva: '1', crm_slot: '60' }} }} }})")
    pg.goto(base + '#/agenda'); pg.wait_for_selector('.ev.reserva')
    ok('aberto para agendamentos pelo site' in pg.inner_text('.ev.reserva'), 'reserva aparece diferente na agenda')
    pg.click('.ev.reserva'); pg.wait_for_selector('#dlg[open]')
    ok(pg.locator('#dlgf button[value=um]').count() == 1, 'clicar na reserva oferece tirar')
    pg.click('#dlgf button[value=cancelar]')

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
