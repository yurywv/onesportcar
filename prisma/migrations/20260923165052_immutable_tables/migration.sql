-- Tabelas append-only: UPDATE e DELETE são bloqueados no banco (spec §8.2).
CREATE OR REPLACE FUNCTION osc_block_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Tabela % é imutável: % não permitido', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['AuditLog','WorkOrderStatusHistory','Approval','EstimateVersion','InventoryMovement']
  LOOP
    EXECUTE format('CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION osc_block_mutation()', t || '_immutable', t);
  END LOOP;
END $$;
