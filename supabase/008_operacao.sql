-- Etapa 3 do Manual Mestre: tarefas, histórico de contatos, onboarding e financeiro com despesas.

-- tarefas: criadas à mão, com ou sem projeto (responsável único = a Sabrina)
create table if not exists public.crm_tarefas(
  id uuid primary key default gen_random_uuid(),
  projeto_id uuid references public.crm_projetos on delete cascade,
  cliente_id uuid references public.crm_clientes on delete cascade,
  titulo text not null, descricao text,
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta')),
  prazo date,
  status text not null default 'a_fazer' check (status in ('a_fazer','fazendo','feita')),
  link text, -- anexo: link do Drive, Canva…
  concluida_em date, criado_em timestamptz not null default now());
create index if not exists crm_tarefa_proj on public.crm_tarefas(projeto_id);

-- histórico: reuniões, ligações, mensagens… de cada lead/cliente
create table if not exists public.crm_interacoes(
  id uuid primary key default gen_random_uuid(),
  cliente_id uuid not null references public.crm_clientes on delete cascade,
  oportunidade_id uuid references public.crm_oportunidades on delete set null,
  tipo text not null default 'reuniao' check (tipo in ('reuniao','ligacao','mensagem','email','visita','nota')),
  resumo text not null, data date not null default current_date,
  criado_em timestamptz not null default now());
create index if not exists crm_inter_cliente on public.crm_interacoes(cliente_id);

-- onboarding (checklist [{item, feito}]) e data de entrada como cliente
alter table public.crm_clientes
  add column if not exists onboarding jsonb,
  add column if not exists cliente_desde date;

create or replace function public.crm_dar_codigo(p_cliente uuid) returns text
language plpgsql security invoker set search_path = '' as $$
declare cod text;
begin
  select codigo into cod from public.crm_clientes where id = p_cliente for update;
  if cod is null then
    cod := 'R' || lpad(nextval('public.crm_cliente_seq')::text, 3, '0');
    update public.crm_clientes set codigo = cod, cliente_desde = coalesce(cliente_desde, current_date) where id = p_cliente;
  end if;
  return cod;
end $$;
update public.crm_clientes set cliente_desde = criado_em::date where codigo is not null and cliente_desde is null;

-- financeiro: parcelas viram lançamentos (receita ou despesa), com ou sem projeto
alter table public.crm_parcelas
  alter column projeto_id drop not null,
  add column if not exists tipo text not null default 'receita' check (tipo in ('receita','despesa')),
  add column if not exists categoria text,
  add column if not exists cliente_id uuid references public.crm_clientes on delete set null,
  add column if not exists contrato_id uuid references public.crm_contratos on delete set null;
create index if not exists crm_parcela_contrato on public.crm_parcelas(contrato_id);

do $$ declare t text; begin
  foreach t in array array['crm_tarefas','crm_interacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_tudo on public.%I', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop; end $$;
