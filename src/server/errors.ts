export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    // Structured detail returned next to the message, for callers that act on each item.
    public readonly issues?: unknown,
  ) {
    super(message);
  }
}
