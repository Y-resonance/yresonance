import { createFileRoute } from '@tanstack/react-router';
import { WipPage } from '#/components/public-page';
import { wipPageHead } from '#/lib/seo';

export const Route = createFileRoute('/terms')({
  component: () => <WipPage title="Terms" />,
  head: () => wipPageHead('Terms'),
});
