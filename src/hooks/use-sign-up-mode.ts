import { useClerk } from '@clerk/tanstack-react-start';
import { useSyncExternalStore } from 'react';
import { z } from 'zod';

const environmentSchema = z.object({
  userSettings: z.object({
    signUp: z.object({ mode: z.enum(['public', 'restricted', 'waitlist']) }),
  }),
});

export function useSignUpMode() {
  const clerk = useClerk();
  // Clerk has no public access-mode hook. Keep this internal SDK dependency here and
  // validate its shape so missing or changed configuration never advertises open sign-up.
  function getMode() {
    const environment = environmentSchema.safeParse(
      '__internal_environment' in clerk ? clerk.__internal_environment : undefined,
    );
    return environment.success ? environment.data.userSettings.signUp.mode : undefined;
  }

  // Clerk's instance stays the same when loading completes. Subscribe explicitly so
  // server-rendered signed-out pages pick up the configuration once it arrives.
  return useSyncExternalStore(
    (onChange) => {
      clerk.on('status', onChange);
      return () => clerk.off('status', onChange);
    },
    getMode,
    getMode,
  );
}
