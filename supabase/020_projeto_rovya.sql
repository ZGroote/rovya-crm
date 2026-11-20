-- Projeto da própria Rovya (interno): sem cliente. As telas mostram "Rovya" quando cliente_id é nulo.
alter table public.crm_projetos alter column cliente_id drop not null;
