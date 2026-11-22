import { loadDotEnv } from '../lib/env.js';
import { collectAll, loadConfig } from '../lib/build.js';
import { readSnapshot, writeSnapshot } from '../lib/store.js';

loadDotEnv();

const isDirect = process.argv[1] && process.argv[1].endsWith('run.js');

export async function collectAndStore({ env = process.env } = {}) {
  const config = await loadConfig();
  const { snapshot: previous } = await readSnapshot();
  const snapshot = await collectAll({
    env,
    config,
    previous,
    delayMs: Number(env.COLLECT_DELAY_MS || 200),
    onAccount: async (account, accounts) => {
      const parts = Object.entries(account.platforms).map(([id, platform]) => {
        const bits = [platform.status];
        if (typeof platform.views === 'number') bits.push(`views=${platform.views}${platform.viewsComplete ? '' : ' partial'}`);
        if (typeof platform.likes === 'number') bits.push(`likes=${platform.likes}`);
        if (typeof platform.followers === 'number') bits.push(`followers=${platform.followers}`);
        if (platform.error) bits.push(platform.error);
        return `${id}:${bits.join(' ')}`;
      });
      console.log(`[${accounts.length}/${config.accounts.length}] ${account.handle}${parts.length ? `  ${parts.join(' | ')}` : ''}`);
    },
  });
  const stored = await writeSnapshot(snapshot);
  return { snapshot, stored };
}

if (isDirect) {
  collectAndStore().then(({ snapshot, stored }) => {
    const views = snapshot.projection.recorded;
    console.log(`Checked ${snapshot.checkedAt}`);
    console.log(`Default-cohort views: ${views == null ? 'none' : views}${snapshot.coverage.partial ? ' (includes partial)' : ''}`);
    console.log(`Accounts with views: ${snapshot.coverage.withViews} of ${snapshot.coverage.defaultCohort}`);
    console.log(`Persisted file=${stored.file} blob=${stored.blob}`);
    if (!stored.persisted) console.log('Nothing was persisted. On Vercel, set BLOB_READ_WRITE_TOKEN so cron can store snapshots.');
    if (snapshot.warnings.length) {
      console.log(`Warnings (${snapshot.warnings.length}):`);
      for (const warning of snapshot.warnings) console.log(`  ${warning}`);
    }
  }).catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
