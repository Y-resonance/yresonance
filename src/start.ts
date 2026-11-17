import { platform } from '#/platform/index.server';
import { createIsomorphicFn, createMiddleware, createStart } from '@tanstack/react-start';

// Request auth runs only on the server; keep deployment adapters out of the browser bundle.
const authMiddleware = createIsomorphicFn()
  .server(() => platform.auth.middleware())
  .client(() => createMiddleware());

export const startInstance = createStart(() => {
  return {
    requestMiddleware: [authMiddleware()],
  };
});
