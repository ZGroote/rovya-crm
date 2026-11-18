-- O resumo das 7h30 (retrato do CRM + Google + push) pode passar dos 5 s padrão do pg_net:
-- a função seguia rodando, mas a resposta não ficava registrada. Mesmo tempo da verificação (30 s).
select cron.unschedule('crm-resumo-diario') where exists (select 1 from cron.job where jobname = 'crm-resumo-diario');
select cron.schedule('crm-resumo-diario', '30 10 * * *', $$
  select net.http_post(
    url := 'https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-assistente',
    headers := jsonb_build_object('Content-Type','application/json','x-cron',(select valor from public.crm_config where chave = 'cron_key')),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000)
$$);
