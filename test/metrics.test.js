import test from 'node:test';
import assert from 'node:assert/strict';
import { num, sumNumbers } from '../lib/num.js';
import { mergePlatform } from '../lib/platforms.js';
import { aggregate, growthFor, toggleSelection } from '../lib/aggregate.js';
import { chooseRate, estimateAt, measuredRate } from '../lib/project.js';
import { createLiveCounter } from '../lib/live.js';
import { velocityFromVideos } from '../collector/tiktok.js';
import { combineTikTok, parseTikTokEmbed, parseTikTokProfile } from '../collector/tiktok.js';
import { interpretApifyItems } from '../collector/apify-tiktok.js';

test('missing numbers stay null and are not summed as zero', () => {
  assert.equal(num(null), null);
  assert.equal(num(''), null);
  assert.equal(num('nope'), null);
  assert.equal(num(0), 0);
  assert.equal(sumNumbers([null, undefined]), null);
  assert.equal(sumNumbers([null, 0, 4]), 4);
});

test('a failed collect never wipes a previous reading', () => {
  const prev = { status: 'available', views: 10, likes: 5, followers: 2, comments: null, viewsComplete: true };
  const failed = mergePlatform(prev, { ok: false, error: 'timeout' }, { checkedAt: '2026-11-22T00:00:00.000Z' });
  assert.equal(failed.views, 10);
  assert.equal(failed.likes, 5);
  assert.equal(failed.status, 'stale');
  assert.equal(failed.error, 'timeout');

  const empty = mergePlatform(null, { ok: false, error: 'not found' });
  assert.equal(empty.views, null);
  assert.equal(empty.followers, null);
  assert.equal(empty.status, 'unavailable');
});

test('a null field on success keeps the previous number, and a real zero is kept', () => {
  const prev = { views: 10, likes: 5, followers: 2, comments: 1, viewsComplete: true };
  const kept = mergePlatform(prev, { ok: true, views: null, likes: 9, followers: 4, comments: null, source: 'test' });
  assert.equal(kept.views, 10);
  assert.equal(kept.likes, 9);
  assert.equal(kept.followers, 4);
  assert.equal(kept.comments, 1);
  const zero = mergePlatform(prev, { ok: true, views: 0, likes: 0, followers: 0, comments: 0, viewsComplete: true });
  assert.equal(zero.views, 0);
  assert.equal(zero.likes, 0);
});

const snapshot = {
  accounts: [
    {
      id: 'quest', handle: 'quest', name: 'Quest', category: 'quests',
      platforms: {
        tiktok: { handle: 'quest', status: 'partial', views: 100, likes: 5, comments: null, followers: 20, viewsComplete: false },
        youtube: { handle: 'quest', status: 'unavailable', views: null, likes: null, comments: null, followers: null },
      },
    },
    {
      id: 'fan', handle: 'fan', name: 'Fan page', category: 'fan',
      platforms: {
        tiktok: { handle: 'fan', status: 'available', views: 50, likes: null, comments: 3, followers: 8, viewsComplete: true },
      },
    },
    {
      id: 'person', handle: 'person', name: 'Person', category: 'creators',
      platforms: {
        tiktok: { handle: 'person', status: 'available', views: 999, likes: 40, comments: 1, followers: 70, viewsComplete: true },
      },
    },
  ],
};

test('creators are off by default and nulls are not zeros', () => {
  const view = aggregate(snapshot);
  assert.equal(view.matched, 2);
  assert.equal(view.views, 150);
  assert.equal(view.likes, 5);
  assert.equal(view.comments, 3);
  assert.equal(view.followers, 28);
  assert.equal(view.viewsPartial, true);
  assert.equal(view.platformTotals.youtube.views, null);
  assert.equal(view.platformTotals.tiktok.views, 150);
});

test('multi-select filters recompute totals and All is exclusive', () => {
  const creators = aggregate(snapshot, { categories: ['creators'], platforms: ['all'] });
  assert.equal(creators.matched, 1);
  assert.equal(creators.views, 999);
  const both = aggregate(snapshot, { categories: ['quests', 'fan'], platforms: ['tiktok', 'youtube'] });
  assert.equal(both.views, 150);
  assert.equal(both.platformTotals.youtube.views, null);
  assert.equal(toggleSelection(['all'], 'tiktok').join(), 'tiktok');
  assert.equal(toggleSelection(['tiktok', 'youtube'], 'tiktok').join(), 'youtube');
  assert.equal(toggleSelection(['youtube'], 'youtube').join(), 'all');
  assert.equal(toggleSelection(['tiktok', 'instagram'], 'all').join(), 'all');
  const search = aggregate(snapshot, { categories: ['all'], platforms: ['tiktok'], query: 'fan' });
  assert.deepEqual(search.accounts.map((account) => account.id), ['fan']);
  assert.equal(search.views, 50);
});

test('growth uses a snapshot at least a day old and ignores null history', () => {
  const now = Date.parse('2026-11-22T00:00:00.000Z');
  const history = [
    { checkedAt: '2026-11-20T00:00:00.000Z', accounts: { quest: { tiktok: { views: 40 } } } },
    { checkedAt: '2026-11-21T12:00:00.000Z', accounts: { quest: { tiktok: { views: 80 } } } },
  ];
  const account = aggregate(snapshot).accounts.find((item) => item.id === 'quest');
  const growth = growthFor(history, account, 'views', 'all', now);
  assert.equal(growth.delta, 60);
  const tooSoon = growthFor([
    { checkedAt: '2026-11-21T12:00:00.000Z', accounts: { quest: { tiktok: { views: 80 } } } },
  ], account, 'views', 'all', now);
  assert.equal(tooSoon, null);
});

test('the live counter climbs every moment and never steps down', () => {
  const counter = createLiveCounter();
  const start = Date.parse('2026-11-22T00:00:00.000Z');
  counter.push(1000, 0.5, start);
  const later = counter.sample(start + 2000);
  assert.ok(later >= 1000.9 && later <= 1001.1);
  counter.push(900, 0.5, start + 2000);
  const held = counter.sample(start + 2000);
  assert.ok(held >= later - 0.001);
  const stillUp = counter.sample(start + 4000);
  assert.ok(stillUp > held);
  assert.equal(chooseRate(0, 0.25).source, 'video-velocity');
  assert.equal(chooseRate(1.2, 0.25).source, 'measured');
  const hour = 3600 * 1000;
  const rate = velocityFromVideos([
    { id: '1', playCount: 3600, createdAt: start - hour },
  ], start);
  assert.ok(Math.abs(rate - 1) < 0.01);
});

test('the live estimate ticks only from a positive measured rate', () => {
  const config = { accounts: [{ id: 'quest', name: 'Quest', handle: 'quest', category: 'quests' }] };
  const history = [
    { checkedAt: '2026-11-21T00:00:00.000Z', accounts: { quest: { tiktok: { views: 1000 } } } },
    { checkedAt: '2026-11-21T01:00:00.000Z', accounts: { quest: { tiktok: { views: 1360 } } } },
  ];
  const rate = measuredRate(history, config);
  assert.equal(rate.perSecond, 0.1);
  const estimate = estimateAt(rate, 1360, Date.parse('2026-11-21T01:00:10.000Z'));
  assert.equal(estimate.mode, 'estimate');
  assert.equal(estimate.value, 1361);
  const held = estimateAt({ ...rate, perSecond: -2 }, 1360, Date.parse('2026-11-21T02:00:00.000Z'));
  assert.equal(held.mode, 'flat');
  assert.equal(held.value, 1360);
  const still = estimateAt({ perSecond: null, anchorAt: rate.anchorAt }, 1360, Date.now());
  assert.equal(still.mode, 'recorded');
  assert.equal(still.value, 1360);
});

test('tiktok public parse keeps profile likes and marks a short embed partial', () => {
  const profileHtml = `<script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
    __DEFAULT_SCOPE__: {
      'webapp.user-detail': {
        statusCode: 0,
        userInfo: {
          user: { uniqueId: 'americahousedc', nickname: 'America House' },
          stats: { followerCount: 113, heartCount: 910, videoCount: 39 },
        },
      },
    },
  })}</script>`;
  const embedHtml = `<script id="__FRONTITY_CONNECT_STATE__" type="application/json">${JSON.stringify({
    source: { data: { '/embed/@americahousedc': { videoList: [{ id: '1', playCount: 270 }, { id: '2', playCount: 30 }] } } },
  })}</script>`;
  const combined = combineTikTok(parseTikTokProfile(profileHtml), parseTikTokEmbed(embedHtml));
  assert.equal(combined.ok, true);
  assert.equal(combined.followers, 113);
  assert.equal(combined.likes, 910);
  assert.equal(combined.views, 300);
  assert.equal(combined.viewsComplete, false);
  assert.equal(combined.comments, null);
});

test('apify video rows do not invent a lifetime like total from one digg count', () => {
  const parsed = interpretApifyItems([
    { playCount: 10, diggCount: 2, commentCount: 1, authorMeta: { fans: 100, video: 40 } },
    { playCount: 15, diggCount: 3, commentCount: 0, authorMeta: { fans: 100, video: 40 } },
  ]);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.followers, 100);
  assert.equal(parsed.views, 25);
  assert.equal(parsed.viewsComplete, false);
  assert.equal(parsed.likes, null);
  assert.equal(parsed.comments, null);
});
