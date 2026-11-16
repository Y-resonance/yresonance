import { createServer, type Socket } from 'node:net';
import { sql } from 'drizzle-orm';
import { expect, test } from 'vitest';
import { database, withDatabaseScope } from '../../src/server/database.server';

test('a connection-phase rejection fails the query even when the peer leaves the socket open', async () => {
  let peer: Socket | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const server = createServer((socket) => {
    peer = socket;
    socket.once('data', () => {
      const payload = Buffer.from('SFATAL\0C28000\0Mconnection rejected\0\0');
      const frame = Buffer.alloc(5 + payload.length);
      frame[0] = 'E'.charCodeAt(0);
      frame.writeInt32BE(payload.length + 4, 1);
      payload.copy(frame, 5);
      socket.write(frame);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test TCP port');
  try {
    const operation = withDatabaseScope(
      `postgres://test:test@127.0.0.1:${address.port}/test`,
      async () => {
        await database().execute(sql`SELECT 1`);
      },
      true,
    );
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Query remained pending after connection rejection')),
        2000,
      );
    });
    await expect(Promise.race([operation, timeout])).rejects.toMatchObject({
      cause: { message: 'connection rejected' },
    });
  } finally {
    clearTimeout(timer);
    peer?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
