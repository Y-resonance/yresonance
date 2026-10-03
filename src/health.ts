export function createHealthResponse() {
  return Response.json(
    {
      service: 'yresonance',
      status: 'ok',
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  );
}
