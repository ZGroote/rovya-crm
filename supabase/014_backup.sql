-- Backup automático semanal: toda segunda às 3h de Brasília (6h UTC) a função crm-google salva todas as tabelas
-- do CRM num JSON na pasta "15 — Tecnologia e Sistemas" do Drive (guarda os 12 mais recentes). Falha vira aviso em crm_falhas.
select cron.unschedule(jobid) from cron.job where jobname = 'crm-backup-semanal';
select cron.schedule('crm-backup-semanal', '0 6 * * 1', $$
  select net.http_post(
    url := 'https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-google',
    headers := jsonb_build_object('Content-Type','application/json','x-cron',(select valor from public.crm_config where chave = 'cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 60000)
$$);

-- as pastas que o CRM usa (07 clientes, 15 backups) não podem faltar na estrutura (a tela já não deixa remover)
insert into public.crm_drive(chave, nome) values ('07','07 — Clientes e Onboarding'), ('15','15 — Tecnologia e Sistemas')
on conflict (chave) do nothing;
