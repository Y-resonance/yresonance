/** Routes the container transport to the same query-engine boundary as local mode. */
export function getContainer() {
  return {
    fetch(request: Request) {
      return fetch(new Request('http://query-engine.test/__query-engine', request));
    },
  };
}
