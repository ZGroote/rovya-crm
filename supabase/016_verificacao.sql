-- Verificação automática a cada 6 h (00:15, 06:15, 12:15, 18:15 UTC): a crm-assistente testa o Google e o Gemini.
-- O que está funcionando sai da tela de falhas (resolvida = true; a linha fica no banco). O que quebrou vira um aviso só.
select cron.unschedule('crm-verificacao') where exists (select 1 from cron.job where jobname = 'crm-verificacao');
select cron.schedule('crm-verificacao', '15 */6 * * *', $$
  select net.http_post(
    url := 'https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-assistente',
    headers := jsonb_build_object('Content-Type','application/json','x-cron',(select valor from public.crm_config where chave = 'cron_key')),
    body := '{"verificar":true}'::jsonb,
    timeout_milliseconds := 30000)
$$);
