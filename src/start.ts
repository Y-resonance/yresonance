import { clerkMiddleware } from '@clerk/tanstack-react-start/server';
import { createIsomorphicFn, createStart } from '@tanstack/react-start';

const requestMiddleware = createIsomorphicFn()
  .client(() => [])
  .server(async () => {
    const { authProvider } = await import('./auth/config.server');
    return authProvider() === 'clerk' ? [clerkMiddleware()] : [];
  });

export const startInstance = createStart(async () => ({
  requestMiddleware: await requestMiddleware(),
}));
