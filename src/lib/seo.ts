export const siteUrl = 'https://yresonance.com';

export const publicPages = {
  '/': {
    title: 'yresonance | Dashboard builder for client reporting',
    description:
      'Build client reporting dashboards from CSV, Parquet or ClickHouse data. Draft with your agent, edit charts and formulas, and share reports with clients.',
  },
  '/imprint': {
    title: 'Imprint and creator | yresonance',
    description:
      'Meet Patrik Simms, the product engineer behind yresonance, and find service provider details and contact information.',
  },
};

export const landingFaqs = [
  {
    question: 'What is yresonance?',
    answer:
      'yresonance is a dashboard builder for client reporting. You can create charts, tables and scorecards, edit formulas, and share reports with clients.',
  },
  {
    question: 'Which data sources can I use?',
    answer:
      'You can upload CSV and Parquet files, register existing files, or connect an authorized ClickHouse table. DuckDB and ClickHouse execute the dashboard queries.',
  },
  {
    question: 'Can an AI agent build my dashboard?',
    answer:
      'An external agent that supports WebMCP can create dashboards and widgets through the site tools. You can inspect and edit the result in the dashboard editor. There is no AI chat inside the app.',
  },
  {
    question: 'How do I share a report?',
    answer:
      'Send an unlisted dashboard link or grant a signed-in colleague access. Viewers can use the published pages and controls without editing the dashboard.',
  },
];

export function publicPageHead(path: keyof typeof publicPages) {
  const page = publicPages[path];
  const url = `${siteUrl}${path}`;
  return {
    meta: [
      { title: page.title },
      { name: 'description', content: page.description },
      { property: 'og:title', content: page.title },
      { property: 'og:description', content: page.description },
      { property: 'og:url', content: url },
      { property: 'og:type', content: 'website' },
    ],
    links: [{ rel: 'canonical', href: url }],
  };
}
