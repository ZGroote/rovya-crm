# Rovya · CRM de gestão

**No ar:** https://crm.rovyacreative.com.br/ (GitHub Pages, repositório ZGroote/rovya-crm). Para instalar no celular: iPhone → Safari → Compartilhar → Adicionar à Tela de Início; Android → Chrome → menu ⋮ → Instalar app.

Ao mudar arquivos, aumente o `?v=` do app.js/app.css no app.html para o navegador não usar a versão antiga. O `supabase/002_seed.sql` (textos do método da Sabrina) fica fora do GitHub de propósito.

Site estático (HTML + JS, sem build) com dados no Supabase, projeto **rovya-stickers** (o mesmo das figurinhas). As tabelas do CRM começam com `crm_`.

- `login.html`: login da rosa. Só entra quem está na tabela `admins` (hoje: rovyacreative@gmail.com, a mesma senha da Área da Rovya das figurinhas).
- `app.html` / `app.js` / `app.css`: o CRM. Início, Funil, Clientes, Projetos (etapas e entregas), Agenda, Financeiro e Modelos.
- `util.js`: funções comuns (formulário, toast, consultas) usadas por todos os módulos.
- `comercial.js` + `comercial.css`: Serviços (catálogo), Propostas com versões e PDF (Salvar como PDF do navegador, nome `ROVYA_[CLIENTE]_PROPOSTA_[data]_V01`).
- `contratos.js`: contratos recorrente/avulso/misto, assinatura externa + anexo, alertas de vencimento no Início. Nada muda de status sozinho.
- `supabase/006_comercial.sql`: serviços, propostas, contratos e o código de cliente R001 (dado por trigger no primeiro contrato ou projeto). Já foi aplicado.
- `drive.js`: Google Drive com escopo `drive.file` (o CRM só enxerga o que ele mesmo criou). Tela **Documentos** cria a estrutura `ROVYA — GESTÃO EMPRESARIAL` com as 18 áreas; a ficha do cliente cria `CLIENTE_R001_NOME` dentro de "07 — Clientes e Onboarding", só com as subpastas marcadas; proposta e contrato têm "Enviar ao Drive" (nome `ROVYA_[COD]_[TIPO]_[data]_V01`). Os IDs ficam em `crm_drive`, `crm_clientes.drive_*` e `crm_documentos` (`supabase/007_drive.sql`, aplicado). O navegador pede à função `crm-google` (ação `token`) um acesso de 1 h e fala direto com o Drive.
- `tarefas.js`: tarefas manuais (com ou sem projeto), aba Tarefas no projeto e cartão no Início.
- `financeiro.js`: livro de lançamentos (`crm_parcelas` com `tipo` receita/despesa, categoria, cliente, contrato), CSV, e "Lançar no financeiro" no contrato (mensalidades sem duplicar meses).
- Ficha do cliente: histórico de contatos (`crm_interacoes`, também pelo botão "Registrar contato" no funil, que atualiza o próximo passo) e checklist de onboarding (`crm_clientes.onboarding`). `supabase/008_operacao.sql` já foi aplicado.
- `producao.js`: tela **Produção**, um quadro com todas as peças (entregas) dos projetos ativos por status (arrastar muda o status). Cada peça tem **formato**, contador de **revisões** (R2 = voltou duas vezes) e data de **aprovação**, que o trigger `crm_entrega` preenche a partir do status escolhido pela Sabrina (`supabase/010_producao.sql`).
- **Encerrar projeto** (botão no projeto): lista as pendências (peças, tarefas, valores a receber, contratos vigentes), baixa o CSV de entregáveis, pede a retenção e só arquiva com confirmação. "Arquivado" não apaga nada.
- **Falhas de integração:** erros do Drive, do Google e do Assistente vão para `crm_falhas` e aparecem em Configurações até serem marcados como resolvidos.
- **Verificação automática a cada 6 h** (pg_cron `crm-verificacao`, `supabase/016_verificacao.sql`): a `crm-assistente` testa o Google (renova o acesso e lê as agendas) e o Gemini (uma pergunta mínima, que também detecta créditos acabados).
  - Funcionando: as falhas de `crm-google`, `drive` e `crm-assistente` são marcadas como resolvidas. Nada é apagado, e o `crm_log` guarda quem marcou.
  - Quebrado: entra um aviso só, sem repetir a cada 6 h, e ele sai sozinho quando volta a funcionar.
  - Erros de tela saem depois de 3 dias. Falhas de backup saem quando um backup seguinte dá certo. Conflitos de agenda (`agenda`) esperam a Sabrina.
- **Duas contas de administrador:** rovyacreative@ (Sabrina) e jaogroote@ (manutenção). A verificação em duas etapas vale por conta, então se a Sabrina ativar na dela, a de manutenção continua entrando só com a senha.
- `config.js`: endereço e chave publicável do Supabase. Quem protege os dados é o RLS.
- `supabase/001_crm.sql`: tabelas, RLS, bucket privado `crm-anexos` e a função `crm_projeto_de_modelo`. Já foi aplicado.
- `supabase/002_seed.sql`: modelo de projeto “Gestão estratégica da comunicação”, com as 6 etapas do Trello da Conecta, as orientações e 29 entregas. Já foi aplicado.
- `supabase/functions/crm-google`: ponte com o Google Agenda. Já está publicada, com `verify_jwt = false`, porque o retorno do Google chega sem login. O POST confere se quem chama é administradora.

## Como funciona o fluxo

1. **Funil:** Primeiro contato → Diagnóstico → Proposta enviada → Negociação → Fechado / Perdido. Cada cartão tem próximo passo e data, que aparecem no Início.
2. Quando um cartão chega em **Fechado**, o CRM cria o projeto a partir de um modelo, copiando as etapas e as entregas.
3. **Projeto:** cada etapa tem a orientação para o cliente (`{{empresa}}` e `{{contato}}` são trocados pelos dados do cliente). Cada entrega tem status (a fazer, em produção, enviado, em revisão, aprovado), prazo, texto de entrega, link e anexos.
4. **Financeiro:** as parcelas são lançadas dentro do projeto (“Dividir em parcelas”). O botão **Recebi** dá baixa.
5. **Modelos:** os textos usam `{{empresa}}`, `{{contato}}` e `{{cliente}}`. Para criar um modelo de projeto novo, abra um projeto e use Editar → “Salvar estrutura como modelo”.

## Google (Agenda, Drive, Contatos, Gmail)

Projeto **crm-sa-514601** no Google Cloud, app OAuth “Rovya CRM” **em produção** (sem verificação: aparece “app não verificado” → Avançado → Acessar).
APIs ativadas: Calendar, Drive, Gmail, People. Os escopos não ficam declarados na tela de consentimento de propósito (declarar escopos sensíveis faz o Google exigir a verificação formal).
Redirecionamento: `https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-google`; secrets `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET` no Supabase.

Escopos pedidos ao conectar (lista `ESCOPOS` em `crm-google`): `calendar.events`, `calendar.calendarlist.readonly`, `calendar.app.created`, `drive.file`, `contacts.readonly`, `gmail.send`. Os escopos aceitos ficam em `crm_google.escopos`; se faltar algum, a Agenda mostra **Reconectar Google**.

- **Agendas:** o botão “Agendas” escolhe a **profissional** (padrão; recebe reuniões, reservas e agendamentos do site), a **pessoal** (pode ser criada pelo CRM) e outras só para ver. Fica em `crm_google.agendas`. O Google é a fonte da verdade: não há cópia para sincronizar.
- **Ligação com clientes:** o CRM grava o cliente em `extendedProperties.private.crm_cliente`. Compromissos antigos são ligados na hora de mostrar, pelo e-mail de um convidado ou pelo nome/empresa (4+ letras) no título. A ficha do cliente busca os compromissos dele (2 anos para trás, 6 meses para frente).
- **Meet e convite:** “Criar link do Meet” e “Convidar o cliente” no compromisso (o Google manda o convite e os lembretes).
- **Gmail:** botão E-mail na ficha do cliente; sai da conta conectada, com anexos até 15 MB, e fica no histórico.
- **Contatos:** Clientes → Importar do Google (só os que ainda não estão no CRM, pelo e-mail ou pelos últimos 9 dígitos do telefone).

### Agenda pública (rovyacreative.com.br/agendar)

A Sabrina abre Agenda → **Horários da semana** (`#/horarios`, `#/horarios/1` = próxima semana) e pinta a semana hora a hora, das 6h às 22h, escolhendo o tipo. Horas seguidas do mesmo tipo viram um evento só. Com “Repetir toda semana” (marcado por padrão), o evento repete sem fim, até ela tirar. Tocar num horário já marcado oferece “Tirar só este dia” ou “Tirar todas as semanas”.
- **Rovya:** evento “Reservado · novos clientes” na profissional (livre, `crm_reserva=1`, `crm_slot=60`); é o que o site oferece.
- **Pessoal:** evento ocupado na agenda pessoal (`crm_bloco=pessoal`), ou privado na profissional se não houver pessoal. Só bloqueia.
- **BNI:** evento ocupado “BNI” na profissional (`crm_bloco=bni`). Só bloqueia.
A página `site/agendar.html` chama a função **crm-agendar** (sem login): ela divide as reservas em conversas e tira o que bate com qualquer compromisso das agendas profissional e pessoal (só devolve início e fim, nunca o que há na agenda).
Ao reservar: trava o horário em `crm_agendamentos` (índice único), acha ou cadastra o cliente (origem “Agenda do site”), cria a reunião com Meet e convite na agenda profissional, registra no histórico, abre a oportunidade e avisa no celular (pela `crm-assistente`, com a `cron_key`).
Regras fixas no código: 12 h de antecedência, até 45 dias para frente, 3 agendamentos por dia do mesmo IP, 2 futuros por e-mail.

## Publicar online

Qualquer hospedagem estática serve (GitHub Pages, como as figurinhas). Depois de publicar, vá no Supabase em **Authentication → URL Configuration → Redirect URLs** e adicione o endereço do CRM com `**` no final. Sem isso, o link de “esqueci minha senha” não volta para o CRM.

## Testar no computador

`python -m http.server 8777 --directory crm` e abra http://localhost:8777/login.html.

**Testes automáticos** (navegador de verdade, dados de mentira): `python testes/rodar.py` roda todos; `python testes/rodar.py offline` roda só os que têm "offline" no nome. Precisa de `pip install playwright`, Google Chrome instalado e `supabase/002_seed.sql` no computador (fica fora do git). O `testes/mock.py` gera `_mock.html`, que finge o Supabase (`window.__D`), registra cada chamada (`window.__log`) e finge o Google Agenda, inclusive sem internet. Os `teste_*.mjs` rodam as funções do Supabase no Node, com Google e banco de mentira (ex.: a conta dos horários livres da agenda pública). Rode antes de publicar qualquer mudança. `teste_sessao_vencida_real.py` é o único que fala com o Supabase de verdade (só leitura, sem login).

## Assistente (IA) e notificações — falta a chave do Gemini

A função `crm-assistente` usa o **Gemini pago** (`gemini-3.8-flash`). O nível grátis usa os dados para treinar, e aqui há dados de clientes. Enquanto não houver chave, o chat responde "falta GEMINI_API_KEY nos secrets".

1. Em https://aistudio.google.com/apikey → **Criar chave de API** → projeto **CRM SA**. A coluna "Plano" precisa dizer **Pago**. Se disser "Free", clique em **Configurar faturamento**.
2. No Supabase (rovya-stickers) → **Edge Functions → Secrets** → crie `GEMINI_API_KEY` com a chave.
3. (Opcional) Em console.cloud.google.com/billing/budgets, crie um orçamento de R$ 30/mês, que só avisa por e-mail.
4. Em cada aparelho (celular e computador): **Tarefas** ou **Assistente** → **🔔 Ativar notificações neste aparelho** → **Testar notificação**. No iPhone, só com o app instalado (Compartilhar → Adicionar à Tela de Início) e aberto pelo ícone. Sem nenhum aparelho ativado (`crm_push` vazio), nenhum aviso chega.

**Lembretes das tarefas** (`supabase/019_lembretes.sql`): na tarefa, "Lembrete (dia e hora)". O pg_cron `crm-lembretes` olha a cada minuto e só chama a função (`{"lembretes":true}`) quando há lembrete vencido, não enviado, de tarefa não feita. A notificação "⏰ título" (cliente, prazo e descrição) vai para todos os aparelhos ativados e abre Tarefas. Não usa IA. Cada lembrete sai uma vez (`lembrete_enviado`); mudar o horário faz valer de novo (trigger `crm_lembrete`).

**Login vencido em segundo plano:** o login vale 1 h. Uma aba esquecida (e o quadro da cópia completa) pode chamar uma função com ele vencido há segundos: o banco ainda aceita, porque tolera 30 s, mas a função recusa ("Sem permissão" em crm-google/listar a cada 90 min). `funcao()` em `util.js` renova o login quando falta menos de 1 min e, se vier 401, renova e tenta de novo uma vez antes de anotar a falha.

O resumo diário sai pelo pg_cron `crm-resumo-diario` (10:30 UTC = 07:30 em Brasília), que chama a função com o header `x-cron`. Na mesma hora vão também:
- **"Precisa da sua atenção"** (só se houver algo): cliente com oportunidade aberta e sem contato há 10+ dias (`SEM_RETORNO_DIAS`), proposta enviada que vence em até 3 dias, contrato vigente dentro do `aviso_dias`, e parcelas a receber atrasadas.
- **"Sua semana"**, às sextas: tarefas feitas, valor recebido, contatos registrados e clientes novos nos últimos 7 dias.

**A Sabrina do canto** (o avatar do site, `img/sabrina-*`, fontes em `3d/poses/`) aparece em todas as telas e abre a conversa. A conversa do dia é a mesma da tela Assistente, guardada no aparelho. Junto com a pergunta vai a tela aberta (`contexto: {rota, id}`), e a função manda para a IA a ficha e o histórico desse cliente.

**Ações:** a IA tem 8 ferramentas: tarefa, contato no histórico, mover no funil, marcar pago, compromisso com Meet, e-mail, WhatsApp e rascunho de proposta. Ela só **propõe**: a função devolve `acoes` e não grava nada. O CRM mostra um cartão para cada ação e, ao confirmar, abre o formulário de sempre já preenchido, ou pergunta "Confirmar?" no funil e no pago. Tudo é gravado com o login dela, pelas mesmas regras (RLS, MFA, fila sem internet). O cartão fica como "Feito", e a IA recebe essa informação nas próximas mensagens. A tela Assistente mostra "O que eu faço por você" com exemplos. Testes: `teste_sabrina.py` (tela) e `teste_assistente_funcao.mjs` (função).

## Segurança, registro e backup (etapa 4)

- **Verificação em duas etapas (MFA):** em Configurações → Ativar, com um app autenticador. Quem ativa só lê/escreve o CRM com o código: as políticas restritivas `crm_mfa` (`supabase/009_seguranca.sql`) exigem sessão `aal2` para quem tem fator verificado, e as Edge Functions conferem o mesmo. Perdeu o celular? No Supabase → Authentication → Users → a usuária → remover o fator MFA; ela entra só com a senha e ativa de novo.
- **Registro de alterações:** a tabela `crm_log` recebe, por trigger, todo insert/update/delete nas tabelas `crm_*` (no update, só os campos que mudaram). O navegador só lê; ninguém edita ou apaga pelo CRM. Itens apagados podem ser restaurados em Configurações → Restaurar (restaure primeiro o “pai”, ex.: o cliente antes do projeto).
- **Backup:** Configurações → Baixar backup ou Salvar no Drive (pasta 15 Tecnologia e Sistemas). Arquivo `ROVYA_BACKUP_AAAA-MM-DD.json` com `{tabelas: {crm_clientes: [...], ...}}`.
- **Backup automático** (`supabase/014_backup.sql`): toda segunda às 3h de Brasília o pg_cron `crm-backup-semanal` chama a função `crm-google` (header `x-cron`), que salva `ROVYA_BACKUP_AAAA-MM-DD_AUTO.json` (mesmo formato) na pasta 15 e manda os automáticos além dos 12 mais recentes para a lixeira do Drive. Se falhar (Google desconectado, pasta 15 ainda não criada), vira aviso no Início. As pastas 07 e 15 não podem ser removidas da estrutura, porque o CRM usa as duas.
- **Erros da tela:** erro de código no navegador vai para `crm_falhas` com origem `tela` (no máximo 5 por visita, nada sem internet) e aparece em Configurações → Falhas, não no Início.
- **Restaurar um backup** (num projeto vazio, depois de rodar os SQL 001…009 em ordem): para cada tabela, na ordem clientes → oportunidades → interacoes → servicos → propostas → contratos → projetos → etapas → entregas → anexos → tarefas → parcelas → modelos → documentos → drive, rode no SQL Editor:
  `insert into public.crm_clientes select * from jsonb_populate_recordset(null::public.crm_clientes, '<cole aqui o array crm_clientes do JSON>'::jsonb) on conflict do nothing;`
  Teste a restauração de vez em quando num projeto de teste: backup que nunca foi restaurado não é garantia.
- **Relatórios:** indicadores comerciais, financeiros e de operação por período, com CSV.
