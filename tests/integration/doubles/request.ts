// TanStack normally supplies the request from its request-local context. Service
// integration tests call the handlers directly and provide that boundary here.
export const requestContext = { request: new Request('https://yresonance.test') };
export function getRequest() {
  return requestContext.request;
}
