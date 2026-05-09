// This function is web-only as native doesn't currently support server
// (or build-time) rendering.
/**
 * Returns a value that is only used on the client-side.
 *
 * @param server - The value to use on the server.
 * @param client - The value to use on the client.
 *
 * @returns The client value on native, as it doesn't support server rendering.
 */
export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  return client;
}
