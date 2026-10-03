/**
 * Deterministic synthetic campaign data for previews and landing page screenshots. The shape mirrors a campaign
 * export an agency would actually register: one row per day, campaign, platform and ad format,
 * with the dimensions that make breakdowns interesting and the metrics a client report reports on.
 */

const columns = [
  'Date',
  'Advertiser',
  'Campaign',
  'Market',
  'Platform',
  'Publisher',
  'AdFormat',
  'Device',
  'Targeting',
  'Impressions',
  'Clicks',
  'VideoCompletions',
  'Conversions',
  'MediaSpend',
] as const;

interface CampaignPlan {
  name: string;
  market: string;
  /** Relative daily volume, so the bar chart has a clear ranking instead of five equal bars. */
  weight: number;
  platforms: string[];
  start: string;
  end: string;
}

const campaigns: CampaignPlan[] = [
  {
    name: 'Spring Launch DE',
    market: 'DE',
    weight: 1,
    platforms: ['Meta', 'TikTok', 'YouTube', 'Programmatic'],
    start: '2026-01-01',
    end: '2026-03-31',
  },
  {
    name: 'Easter Retail DE',
    market: 'DE',
    weight: 0.72,
    platforms: ['Meta', 'Programmatic', 'YouTube'],
    start: '2026-02-09',
    end: '2026-03-31',
  },
  {
    name: 'Always On AT',
    market: 'AT',
    weight: 0.46,
    platforms: ['Meta', 'TikTok', 'Programmatic'],
    start: '2026-01-01',
    end: '2026-03-31',
  },
  {
    name: 'Brand Awareness CH',
    market: 'CH',
    weight: 0.38,
    platforms: ['YouTube', 'Programmatic'],
    start: '2026-01-12',
    end: '2026-03-31',
  },
  {
    name: 'Retail Push HU',
    market: 'HU',
    weight: 0.25,
    platforms: ['Meta', 'TikTok'],
    start: '2026-01-01',
    end: '2026-03-08',
  },
  {
    name: 'Summer Teaser DE',
    market: 'DE',
    weight: 0.19,
    platforms: ['TikTok', 'Meta'],
    start: '2026-03-02',
    end: '2026-03-31',
  },
];

const publishers: Record<string, string[]> = {
  Meta: ['Facebook Feed', 'Instagram Reels'],
  TikTok: ['TikTok For You'],
  YouTube: ['YouTube Shorts', 'YouTube In-Stream'],
  Programmatic: ['Spiegel Online', 'Chip.de', 'Wetter.com'],
};

const formats: Record<string, string[]> = {
  Meta: ['Video', 'Static', 'Carousel'],
  TikTok: ['Video', 'Spark Ad'],
  YouTube: ['Video'],
  Programmatic: ['Static', 'Video'],
};

const devices = ['Mobile', 'Desktop', 'Connected TV'];
const targetings = ['Broad', 'Interest', 'Retargeting', 'Lookalike'];

/** Video formats carry the completion metric and cost more per thousand impressions. */
const isVideoFormat = (format: string) => format === 'Video' || format === 'Spark Ad';

export function exampleCampaignCsv() {
  const random = mulberry32(0x5eed_1234);
  const rows: string[] = [columns.join(',')];

  for (const date of dateRange('2026-01-01', '2026-03-31')) {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    const weekend = day === 0 || day === 6 ? 0.68 : 1;
    // Easter week pulls retail budgets forward, which gives the trend line a real peak.
    const easter = date >= '2026-03-23' && date <= '2026-03-31' ? 1.55 : 1;
    const ramp = 0.7 + 0.6 * (dayIndex(date, '2026-01-01') / 89);

    for (const campaign of campaigns) {
      if (date < campaign.start || date > campaign.end) continue;
      for (const platform of campaign.platforms) {
        for (const format of formats[platform] ?? []) {
          const device =
            platform === 'YouTube' && format === 'Video'
              ? pick(random, devices)
              : pick(random, devices.slice(0, 2));
          const impressions = Math.round(
            48_000 *
              campaign.weight *
              platformVolume(platform) *
              weekend *
              easter *
              ramp *
              (0.72 + random() * 0.56),
          );
          if (impressions < 500) continue;
          const clickRate = 0.0022 + random() * 0.0064 + (format === 'Carousel' ? 0.0018 : 0);
          const clicks = Math.max(1, Math.round(impressions * clickRate));
          const completions = isVideoFormat(format)
            ? Math.round(impressions * (0.24 + random() * 0.21))
            : 0;
          const conversions = Math.round(clicks * (0.018 + random() * 0.05));
          const cpm = (isVideoFormat(format) ? 4.1 : 2.4) * (0.82 + random() * 0.4);
          const spend = (impressions / 1000) * cpm;

          rows.push(
            [
              date,
              'Acme Media',
              campaign.name,
              campaign.market,
              platform,
              pick(random, publishers[platform] ?? ['Unknown']),
              format,
              device,
              pick(random, targetings),
              impressions,
              clicks,
              completions,
              conversions,
              spend.toFixed(2),
            ].join(','),
          );
        }
      }
    }
  }

  return `${rows.join('\n')}\n`;
}

function platformVolume(platform: string) {
  return { Meta: 1, TikTok: 0.78, YouTube: 0.61, Programmatic: 0.83 }[platform] ?? 0.5;
}

function dateRange(start: string, end: string) {
  const dates: string[] = [];
  for (
    let current = new Date(`${start}T00:00:00Z`);
    current <= new Date(`${end}T00:00:00Z`);
    current.setUTCDate(current.getUTCDate() + 1)
  )
    dates.push(current.toISOString().slice(0, 10));
  return dates;
}

function dayIndex(date: string, start: string) {
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000,
  );
}

function pick<T>(random: () => number, values: T[]) {
  return values[Math.floor(random() * values.length)]!;
}

/** Small seeded PRNG so every capture run produces byte-identical data. */
function mulberry32(seed: number) {
  let state = seed;
  return () => {
    state = (state + 0x6d2b_79f5) | 0;
    let drawn = Math.imul(state ^ (state >>> 15), 1 | state);
    drawn = (drawn + Math.imul(drawn ^ (drawn >>> 7), 61 | drawn)) ^ drawn;
    return ((drawn ^ (drawn >>> 14)) >>> 0) / 4_294_967_296;
  };
}
