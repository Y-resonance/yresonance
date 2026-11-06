import { createFileRoute } from '@tanstack/react-router';
import { WipPage } from '#/components/public-page';
import { wipPageHead } from '#/lib/seo';

export const Route = createFileRoute('/privacy')({
  component: () => <WipPage title="Privacy" />,
  head: () => wipPageHead('Privacy'),
});
