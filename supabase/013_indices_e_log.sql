-- Otimizações para os anos de uso: índices nas ligações entre tabelas e limpeza do registro de alterações.

-- 1) Índices nas chaves estrangeiras que estavam sem (apagar um cliente/projeto procura nessas colunas;
--    sem índice, cada exclusão varre a tabela inteira, o que pesa com milhares de linhas)
create index if not exists crm_contr_projeto   on public.crm_contratos(projeto_id);
create index if not exists crm_contr_proposta  on public.crm_contratos(proposta_id);
create index if not exists crm_doc_contrato    on public.crm_documentos(contrato_id);
create index if not exists crm_doc_projeto     on public.crm_documentos(projeto_id);
create index if not exists crm_doc_proposta    on public.crm_documentos(proposta_id);
create index if not exists crm_inter_op        on public.crm_interacoes(oportunidade_id);
create index if not exists crm_parcela_cliente on public.crm_parcelas(cliente_id);
create index if not exists crm_proj_op         on public.crm_projetos(oportunidade_id);
create index if not exists crm_prop_op         on public.crm_propostas(oportunidade_id);
create index if not exists crm_tarefa_cliente  on public.crm_tarefas(cliente_id);

-- 2) Registro de alterações (crm_log): guarda 2 anos. Toda semana, domingo às 4h de Brasília (7h UTC),
--    apaga o que passou disso. Os dados em si (clientes, projetos, contratos…) não são tocados.
select cron.unschedule(jobid) from cron.job where jobname = 'crm-log-limpeza';
select cron.schedule('crm-log-limpeza', '0 7 * * 0', $$
  delete from public.crm_log where quando < now() - interval '2 years'
$$);
