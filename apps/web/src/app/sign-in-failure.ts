// The Battle.net callback sends the visitor home with `?signin=failed` when the sign-in did not finish (IDB-04). The site
// reads that flag once, shows its message, and removes the flag from the address bar so a reload does not repeat it.

/** Whether the query string carries the sign-in failure flag. Pure: it reads and does not change the address. */
export function signInFailedIn(search: string): boolean {
  return new URLSearchParams(search).get('signin') === 'failed';
}

/** Removes the failure flag from the address, keeping the path, any other parameter and the hash. */
export function clearSignInFailure(location: Location, history: History): void {
  const params = new URLSearchParams(location.search);
  if (!params.has('signin')) {
    return;
  }
  params.delete('signin');
  const query = params.toString();
  history.replaceState(
    history.state,
    '',
    `${location.pathname}${query === '' ? '' : `?${query}`}${location.hash}`,
  );
}
