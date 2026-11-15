# Rovya · CRM de gestão

**No ar:** https://zgroote.github.io/rovya-crm/ (GitHub Pages, repositório ZGroote/rovya-crm). Para instalar no celular: iPhone → Safari → Compartilhar → Adicionar à Tela de Início; Android → Chrome → menu ⋮ → Instalar app.

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

## Google Agenda (falta configurar)

1. Em console.cloud.google.com, crie um projeto (“Rovya CRM”) e ative a **Google Calendar API**.
2. **Tela de consentimento OAuth:** escolha Externo, nome Rovya e o e-mail de suporte. Adicione o escopo `.../auth/calendar.events`. Depois clique em **Publicar app** (em produção). Em modo de teste, a autorização expira a cada 7 dias.
3. Em **Credenciais**, crie um ID do cliente OAuth do tipo **Aplicativo da Web**, com este URI de redirecionamento:
   `https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-google`
4. No Supabase (rovya-stickers), vá em **Edge Functions → Secrets** e crie `GOOGLE_CLIENT_ID` e `GOOGLE_CLIENT_SECRET`.
5. No CRM, abra Agenda → **Conectar Google Agenda** e entre com a conta da Rovya. Como o app não é verificado pelo Google, aparece um aviso: clique em “Avançado → continuar”.

Os compromissos criados pelo CRM vão direto para o Google Agenda e guardam o cliente em `extendedProperties.private.crm_cliente`. O Google é a fonte da verdade, então não há cópia para sincronizar.

## Publicar online

Qualquer hospedagem estática serve (GitHub Pages, como as figurinhas). Depois de publicar, vá no Supabase em **Authentication → URL Configuration → Redirect URLs** e adicione o endereço do CRM com `**` no final. Sem isso, o link de “esqueci minha senha” não volta para o CRM.

## Testar no computador

`python -m http.server 8777 --directory crm` e abra http://localhost:8777/login.html.

## Assistente (IA) e notificações — falta a chave do Gemini

A função `crm-assistente` usa o **Gemini pago** (`gemini-3.8-flash`). O nível grátis usa os dados para treinar, e aqui há dados de clientes. Enquanto não houver chave, o chat responde "falta GEMINI_API_KEY nos secrets".

1. Em https://aistudio.google.com/apikey → **Criar chave de API** → projeto **CRM SA**. A coluna "Plano" precisa dizer **Pago**. Se disser "Free", clique em **Configurar faturamento**.
2. No Supabase (rovya-stickers) → **Edge Functions → Secrets** → crie `GEMINI_API_KEY` com a chave.
3. (Opcional) Em console.cloud.google.com/billing/budgets, crie um orçamento de R$ 30/mês, que só avisa por e-mail.
4. No celular, instale o app (Adicionar à tela inicial) → **Assistente** → **🔔 Receber resumo às 7h30** → **Testar notificação**.

O resumo diário sai pelo pg_cron `crm-resumo-diario` (10:30 UTC = 07:30 em Brasília), que chama a função com o header `x-cron`.

## Segurança, registro e backup (etapa 4)

- **Verificação em duas etapas (MFA):** em Configurações → Ativar, com um app autenticador. Quem ativa só lê/escreve o CRM com o código: as políticas restritivas `crm_mfa` (`supabase/009_seguranca.sql`) exigem sessão `aal2` para quem tem fator verificado, e as Edge Functions conferem o mesmo. Perdeu o celular? No Supabase → Authentication → Users → a usuária → remover o fator MFA; ela entra só com a senha e ativa de novo.
- **Registro de alterações:** a tabela `crm_log` recebe, por trigger, todo insert/update/delete nas tabelas `crm_*` (no update, só os campos que mudaram). O navegador só lê; ninguém edita ou apaga pelo CRM. Itens apagados podem ser restaurados em Configurações → Restaurar (restaure primeiro o “pai”, ex.: o cliente antes do projeto).
- **Backup:** Configurações → Baixar backup ou Salvar no Drive (pasta 15 Tecnologia e Sistemas). Arquivo `ROVYA_BACKUP_AAAA-MM-DD.json` com `{tabelas: {crm_clientes: [...], ...}}`. Recomendado: um backup no Drive por semana.
- **Restaurar um backup** (num projeto vazio, depois de rodar os SQL 001…009 em ordem): para cada tabela, na ordem clientes → oportunidades → interacoes → servicos → propostas → contratos → projetos → etapas → entregas → anexos → tarefas → parcelas → modelos → documentos → drive, rode no SQL Editor:
  `insert into public.crm_clientes select * from jsonb_populate_recordset(null::public.crm_clientes, '<cole aqui o array crm_clientes do JSON>'::jsonb) on conflict do nothing;`
  Teste a restauração de vez em quando num projeto de teste: backup que nunca foi restaurado não é garantia.
- **Relatórios:** indicadores comerciais, financeiros e de operação por período, com CSV.
