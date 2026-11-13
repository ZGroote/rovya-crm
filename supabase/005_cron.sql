-- notificação "seu resumo de hoje" todo dia às 7h30 de Brasília (10:30 UTC)
select cron.unschedule(jobid) from cron.job where jobname = 'crm-resumo-diario';
select cron.schedule('crm-resumo-diario', '30 10 * * *', $$
  select net.http_post(
    url := 'https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-assistente',
    headers := jsonb_build_object('Content-Type','application/json','x-cron',(select valor from public.crm_config where chave = 'cron_key')),
    body := '{}'::jsonb)
$$);
