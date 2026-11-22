import { readFileSync } from 'node:fs';

/** Load .env without overriding variables that are already set. Secrets stay off argv. */
export function loadDotEnv(file = '.env') {
  let text = '';
  try { text = readFileSync(file, 'utf8'); } catch { return; }
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match || process.env[match[1]] != null) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}
