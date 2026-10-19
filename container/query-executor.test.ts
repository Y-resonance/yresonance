import { describe, expect, it, vi } from 'vitest';
import { createQueryExecutor } from './query-executor';

describe('query executor', () => {
  it('runs only one DuckDB request at a time', async () => {
    const events: string[] = [];
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const execute = vi.fn<(input: unknown) => Promise<unknown>>(async (input) => {
      events.push(`${input}:start`);
      if (input === 'first') await firstGate;
      events.push(`${input}:end`);
      return input;
    });
    const enqueue = createQueryExecutor(execute);

    const first = enqueue('first', { queryId: 'query-1' });
    const second = enqueue('second', { queryId: 'query-2' });
    await Promise.resolve();
    expect(events).toEqual(['first:start']);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['first:start', 'first:end', 'second:start', 'second:end']);
  });

  it('skips a queued request that was cancelled and continues with the next request', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const execute = vi.fn<(input: unknown) => Promise<unknown>>(async (input) => {
      if (input === 'first') await firstGate;
      return input;
    });
    const enqueue = createQueryExecutor(execute);
    const controller = new AbortController();

    const first = enqueue('first', { queryId: 'query-1' });
    const cancelled = enqueue('cancelled', {
      queryId: 'query-2',
      signal: controller.signal,
    });
    const third = enqueue('third', { queryId: 'query-3' });
    controller.abort(new Error('cancelled'));
    releaseFirst();

    await expect(first).resolves.toMatchObject({ data: 'first' });
    await expect(cancelled).rejects.toThrow('cancelled');
    await expect(third).resolves.toMatchObject({ data: 'third' });
    expect(execute).not.toHaveBeenCalledWith('cancelled');
  });

  it('bounds queued work and releases capacity after completion', async () => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const enqueue = createQueryExecutor(async () => {
      await gate;
      return 'done';
    });
    const pending = Array.from({ length: 32 }, (_, index) =>
      enqueue(index, { queryId: String(index) }),
    );
    try {
      await expect(enqueue('overflow', { queryId: 'overflow' })).rejects.toThrow('queue is full');
    } finally {
      release();
      await Promise.all(pending);
    }
    await expect(enqueue('next', { queryId: 'next' })).resolves.toMatchObject({ data: 'done' });
  });

  it('propagates cancellation after a request has started', async () => {
    const controller = new AbortController();
    const enqueue = createQueryExecutor(
      async (_input, signal) =>
        new Promise((_, reject) => {
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        }),
    );
    const running = enqueue('running', { queryId: 'running', signal: controller.signal });
    await Promise.resolve();
    controller.abort(new Error('caller disconnected'));
    await expect(running).rejects.toThrow('caller disconnected');
  });

  it('does not start a request whose caller deadline has passed', async () => {
    const execute = vi.fn<(input: unknown) => Promise<unknown>>((input) => Promise.resolve(input));
    const enqueue = createQueryExecutor(execute);

    await expect(
      enqueue('expired', { queryId: 'query-1', deadlineAt: Date.now() - 1 }),
    ).rejects.toThrow('timed out while waiting');
    expect(execute).not.toHaveBeenCalled();
  });
});
