import { clerkSetup } from '@clerk/testing/playwright';
import type { FullConfig } from '@playwright/test';
import { clerkCredentials } from './support/clerk-credentials';

/**
 * Confirms the configured port really serves this application before any test runs, so a
 * reused or unrelated process on the port fails loudly instead of producing odd assertions.
 */
export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (!baseURL) throw new Error('Playwright is configured without a baseURL.');

  const health = new URL('/health', baseURL);
  const response = await fetch(health).catch((error: unknown) => {
    throw new Error(`Could not reach ${health.href}: ${String(error)}`);
  });
  if (!response.ok)
    throw new Error(`${health.href} answered HTTP ${response.status}, so this is not Rundown.`);
  const body = (await response.json()) as { service?: string };
  if (body.service !== 'rundown')
    throw new Error(
      `${health.href} is served by "${body.service ?? 'an unknown service'}" rather than Rundown. ` +
        'Set RUNDOWN_E2E_PORT to a free port, or stop the process using this one.',
    );

  if (config.projects.some((project) => project.name === 'authenticated') && clerkCredentials())
    await clerkSetup();
}
