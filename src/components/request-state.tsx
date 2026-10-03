import { Alert, AlertDescription, AlertTitle } from '#/components/ui/alert';
import { Skeleton } from '#/components/ui/skeleton';

export function LoadingState() {
  return (
    <div className="flex flex-col gap-3 py-12">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-24 w-full" />
    </div>
  );
}

export function ErrorState({ error }: { error: string }) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Could not load yresonance</AlertTitle>
      <AlertDescription>{error}</AlertDescription>
    </Alert>
  );
}
