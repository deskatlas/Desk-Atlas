import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const directory = resolve(import.meta.dirname, '../supabase');
const read = (name: string) => readFileSync(resolve(directory, name), 'utf8').replace(/\r\n/g, '\n');
const history = readdirSync(resolve(directory, 'archive/pre-consolidation'))
  .filter((name) => /^\d{3}_.*\.sql$/.test(name))
  .sort();

describe('MS-35 / QAD-TC35: consolidated Supabase baseline', () => {
  it('keeps six ordered deployment files without seeds', () => {
    expect(readdirSync(directory).filter((name) => /^\d{3}_.*\.sql$/.test(name)).sort()).toEqual([
      '000_reset_database.sql', '001_schema.sql', '002_functions.sql',
      '003_storage.sql', '004_security_and_rls.sql', '005_realtime.sql',
    ]);
    expect(history.some((name) => name.includes('_seed_'))).toBe(false);
    expect(read('000_reset_database.sql')).toBe(read('archive/pre-consolidation/000_reset_database.sql'));
    expect(read('003_storage.sql')).toBe(read('archive/pre-consolidation/003_storage.sql'));
  });

  it('preserves exactly the latest historical function bodies and all trigger bindings', () => {
    const expression = /CREATE OR REPLACE FUNCTION\s+(public\.\w+)\s*\([\s\S]*?\$\$;/g;
    const latest = new Map<string, string>();
    for (const name of history) {
      for (const match of read(`archive/pre-consolidation/${name}`).matchAll(expression)) {
        latest.set(match[1], match[0].replace(/\r\n/g, '\n'));
      }
    }
    const functions = [...read('002_functions.sql').matchAll(expression)];
    expect(functions).toHaveLength(latest.size);
    for (const match of functions) {
      expect(match[0].replace(/\r\n/g, '\n'), match[1]).toBe(latest.get(match[1]));
    }
    const triggers = /CREATE (?:CONSTRAINT )?TRIGGER\s+\w+[\s\S]*?;/g;
    expect([...read('002_functions.sql').matchAll(triggers)].map((match) => match[0])).toEqual(
      [...read('archive/pre-consolidation/001_schema.sql').matchAll(triggers)]
        .map((match) => match[0].replace(/\r\n/g, '\n')),
    );
    expect(read('001_schema.sql')).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION/);
    expect(read('002_functions.sql')).toContain('ALTER COLUMN reference_code SET DEFAULT public.generate_reservation_reference()');
  });

  it('includes every deployment table and column in DrawSQL with resolvable relationships', () => {
    const tables = (sql: string) => [...sql.matchAll(/CREATE TABLE\s+(?:public\.)?(\w+)\s*\(/g)].map((match) => match[1]);
    const schema = read('001_schema.sql');
    const draw = read('sql_schema.sql');
    const deployed = tables(schema);
    expect(deployed).toHaveLength(18);
    expect(tables(draw)).toEqual(['users', ...deployed]);
    const tableColumns = (sql: string) => [...sql.matchAll(/^  (\w+) (?:uuid(?:\[\])?|text|varchar\(30\)|smallint|integer|boolean|numeric(?:\([^)]*\))?|timestamptz|time|jsonb|char\(3\)|(?:public\.)?\w+)\b/gm)]
      .filter((match) => !['CONSTRAINT', 'FOREIGN', 'REFERENCES', 'ON', 'CHECK', 'UNIQUE', 'PRIMARY'].includes(match[1]))
      .map((match) => match[1]);
    expect(tableColumns(draw)).toEqual(tableColumns(schema));
    const references = [...draw.matchAll(/REFERENCES (\w+)\s*\(/g)].map((match) => match[1]);
    expect(references).toHaveLength(24);
    for (const target of references) expect(tables(draw)).toContain(target);
    expect(draw).toContain('ON UPDATE CASCADE\n  ON DELETE SET NULL');
    expect(draw).toContain("'DAY_PASS', 'NIGHT_PASS'");
    expect(draw).not.toMatch(/CREATE (?:OR REPLACE )?FUNCTION|CREATE TRIGGER|INSERT INTO|BEGIN;/);
  });

  it('retains final RPC restrictions after broad grants and only the verified index removals', () => {
    const security = read('004_security_and_rls.sql');
    expect(security.lastIndexOf('REVOKE ALL ON FUNCTION public.publish_map_version(uuid, uuid) FROM authenticated'))
      .toBeGreaterThan(security.indexOf('GRANT EXECUTE ON ALL ROUTINES IN SCHEMA public TO authenticated, anon'));
    const schema = read('001_schema.sql');
    for (const index of ['idx_reservation_candidates_availability', 'idx_reservation_candidates_reservation_id', 'idx_reservations_reference_code']) {
      expect(schema).not.toMatch(new RegExp(`CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?${index}\\b`));
    }
    for (const index of ['idx_rc_assigned_workspace_window', 'idx_map_elements_instance', 'idx_operating_hours_day_active']) expect(schema).toContain(index);
    expect(read('005_realtime.sql')).toContain("'business_settings', 'operating_hours', 'payment_methods'");
  });
});
