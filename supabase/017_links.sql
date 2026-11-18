-- Links da bio (rovyacreative.com.br/links, o link do perfil do Instagram): a Sabrina cadastra e ordena na aba Links do CRM;
-- a página do site lê direto daqui (sem login), então o que ela salva aparece na hora.
-- Sem login só dá para LER os links ativos; criar, mudar e apagar é só para admin (com MFA, como o resto do CRM).
create table if not exists public.crm_links(
  id uuid primary key default gen_random_uuid(),
  titulo text not null check (length(titulo) between 1 and 80),
  url text not null check (url ~* '^(https?://|mailto:|tel:)' and length(url) <= 600),
  descricao text check (length(descricao) <= 120),
  destaque boolean not null default false,
  ativo boolean not null default true,
  ordem int not null default 0,
  criado_em timestamptz not null default now());
create index if not exists crm_links_ordem on public.crm_links(ordem);
alter table public.crm_links enable row level security;
drop policy if exists admin_tudo on public.crm_links;
create policy admin_tudo on public.crm_links for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists crm_mfa on public.crm_links;
create policy crm_mfa on public.crm_links as restrictive for all to authenticated using (public.crm_aal_ok()) with check (public.crm_aal_ok());
drop policy if exists publico_le on public.crm_links;
create policy publico_le on public.crm_links for select to anon using (ativo);
grant select on public.crm_links to anon;

drop trigger if exists crm_log on public.crm_links;
create trigger crm_log after insert or update or delete on public.crm_links for each row execute function public.crm_log_trg();

-- os primeiros (a revista entra escondida até ter o link)
insert into public.crm_links(titulo, url, descricao, destaque, ativo, ordem)
select * from (values
  ('Agende uma primeira conversa', 'https://rovyacreative.com.br/agendar', 'Online, pelo Google Meet', true, true, 1),
  ('Conheça a ROVYA', 'https://rovyacreative.com.br/', 'Método, projetos e quem eu sou', false, true, 2),
  ('Revista', 'https://rovyacreative.com.br/', 'Em breve', false, false, 3)) v
where not exists (select 1 from public.crm_links);
