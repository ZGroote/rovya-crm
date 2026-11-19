-- Lembrete nas tarefas: a Sabrina escolhe dia e hora; no horário chega uma notificação em cada aparelho que ativou (crm_push).
-- Não usa IA: o pg_cron olha a cada minuto e só chama a função quando há lembrete vencido e ainda não enviado.
alter table public.crm_tarefas add column if not exists lembrete timestamptz;
alter table public.crm_tarefas add column if not exists lembrete_enviado timestamptz;
create index if not exists crm_tarefas_lembrete on public.crm_tarefas(lembrete) where lembrete_enviado is null;

-- mudou o horário do lembrete: vale de novo (envia no horário novo)
create or replace function public.crm_lembrete_trg() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lembrete is distinct from old.lembrete then new.lembrete_enviado := null; end if;
  return new;
end $$;
drop trigger if exists crm_lembrete on public.crm_tarefas;
create trigger crm_lembrete before update on public.crm_tarefas for each row execute function public.crm_lembrete_trg();

select cron.unschedule('crm-lembretes') where exists (select 1 from cron.job where jobname = 'crm-lembretes');
select cron.schedule('crm-lembretes', '* * * * *', $$
  select net.http_post(
    url := 'https://jgigosrsyxjqqhckudfe.supabase.co/functions/v1/crm-assistente',
    headers := jsonb_build_object('Content-Type','application/json','x-cron',(select valor from public.crm_config where chave = 'cron_key')),
    body := '{"lembretes":true}'::jsonb,
    timeout_milliseconds := 30000)
  where exists (select 1 from public.crm_tarefas where lembrete <= now() and lembrete_enviado is null and status <> 'feita')
$$);
