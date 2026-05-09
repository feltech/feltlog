import React from 'react';

// `useEffect` is not invoked during server rendering, meaning
// we can use this to determine if we're on the server or not.
/**
 * Hook to return a value that is only used on the client-side.
 *
 * @param server - The value to use on the server.
 * @param client - The value to use on the client.
 *
 * @returns The appropriate value for the current environment.
 */
export function useClientOnlyValue<S, C>(server: S, client: C): S | C {
  const [value, setValue] = React.useState<S | C>(server);
  React.useEffect(() => {
    setValue(client);
  }, [client]);

  return value;
}
