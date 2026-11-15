-- Etapa 2 do Manual Mestre: Drive como repositório oficial; o CRM guarda só os IDs.

-- pastas da estrutura-mãe (chave: 'raiz', '00'…'17')
create table if not exists public.crm_drive(
  chave text primary key, folder_id text not null, nome text not null,
  criado_em timestamptz not null default now());

-- pasta de cada cliente e as subpastas criadas ({"01":"<id>", "03":"<id>", …})
alter table public.crm_clientes
  add column if not exists drive_pasta text,
  add column if not exists drive_subpastas jsonb not null default '{}';

-- documentos enviados ao Drive pelo CRM
create table if not exists public.crm_documentos(
  id uuid primary key default gen_random_uuid(),
  drive_id text not null unique, nome text not null, link text,
  tipo text not null,          -- PROPOSTA, CONTRATO, BRIEFING, ARTE…
  subpasta text,               -- '03', '09'…
  versao int not null default 1,
  classificacao text not null default 'interno' check (classificacao in ('interno','cliente','confidencial')),
  cliente_id uuid references public.crm_clientes on delete set null,
  projeto_id uuid references public.crm_projetos on delete set null,
  proposta_id uuid references public.crm_propostas on delete set null,
  contrato_id uuid references public.crm_contratos on delete set null,
  tamanho bigint, criado_em timestamptz not null default now());
create index if not exists crm_doc_cliente on public.crm_documentos(cliente_id);

do $$ declare t text; begin
  foreach t in array array['crm_drive','crm_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists admin_tudo on public.%I', t);
    execute format('create policy admin_tudo on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop; end $$;
