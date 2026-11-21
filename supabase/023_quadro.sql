-- Portal em formato de quadro (como o Trello da Sabrina), "Mês de conteúdo" e importação do Trello.
-- Só acrescenta: nenhuma linha existente muda (consulta começa false em todas as etapas).

-- etapa "só consulta" (Planejamento Estratégico, Radar, Guia de Publicação…): o cliente lê, mas não aprova
alter table public.crm_etapas add column if not exists consulta boolean not null default false;

-- criar projeto a partir de um modelo OU de uma estrutura pronta (Mês de conteúdo gerado pelo CRM, importação do Trello).
-- Etapa: {titulo, orientacao, consulta}. Entrega: "título" (modelos antigos) ou {titulo, texto, formato, prazo, status}.
-- No texto da entrega, {{empresa}} e {{contato}} já saem preenchidos com o cliente.
drop function if exists public.crm_projeto_de_modelo(uuid, text, uuid, uuid);
create or replace function public.crm_projeto_de_modelo(p_cliente uuid, p_nome text, p_modelo uuid, p_oportunidade uuid default null, p_estrutura jsonb default null)
returns uuid language plpgsql security invoker set search_path = '' as $$
declare pid uuid; eid uuid; e jsonb; x jsonb; i int := 0; j int; emp text; cont text; st text;
begin
  if not public.is_admin() then raise exception 'sem permissão'; end if;
  select coalesce(empresa, nome), split_part(nome, ' ', 1) into emp, cont from public.crm_clientes where id = p_cliente;
  insert into public.crm_projetos(cliente_id, nome, oportunidade_id) values (p_cliente, p_nome, p_oportunidade) returning id into pid;
  for e in select * from jsonb_array_elements(coalesce(p_estrutura, (select estrutura from public.crm_modelos where id = p_modelo), '[]')) loop
    i := i + 1; j := 0;
    insert into public.crm_etapas(projeto_id, ordem, titulo, orientacao, consulta)
      values (pid, i, e->>'titulo', e->>'orientacao', coalesce((e->>'consulta')::boolean, false)) returning id into eid;
    for x in select * from jsonb_array_elements(coalesce(e->'entregas', '[]')) loop
      j := j + 1;
      if jsonb_typeof(x) = 'string' then x := jsonb_build_object('titulo', x #>> '{}'); end if;
      st := coalesce(x->>'status', 'a_fazer');
      insert into public.crm_entregas(etapa_id, ordem, titulo, texto, formato, prazo, status, aprovado_em)
        values (eid, j, x->>'titulo',
          replace(replace(x->>'texto', '{{empresa}}', coalesce(emp, '{{empresa}}')), '{{contato}}', coalesce(cont, '{{contato}}')),
          x->>'formato', (x->>'prazo')::date, st, case when st = 'aprovado' then now() end);
    end loop;
  end loop;
  return pid;
end $$;
