import { useEffect, useState } from 'react';
import { account } from './storage';

export function AccountStatus() {
  const [status, setStatus] = useState('');
  useEffect(() => {
    let active = true;
    const update = async () => {
      const client = await account;
      if (client && active) {
        const status = await client.status();
        if (active) setStatus(status);
      }
    };
    void update();
    const timer = setInterval(update, 750);
    return () => { active = false; clearInterval(timer); };
  }, []);
  return <span role="status" className="text-sm">{status}</span>;
}

export function Account() {
  const [client, setClient] = useState();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { account.then(setClient, failure => setError(failure.message)); }, []);
  async function submit(event) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(true);
    setError('');
    try {
      if (client.session) await client.logout();
      else await client.login(data.get('name'), data.get('password'), event.nativeEvent.submitter.value === 'create');
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }
  return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">Olymp account</h1>
    <form onSubmit={submit}><fieldset disabled={busy || !client} className="grid gap-3 py-4">
      {client?.session ? <><p>{client.session.account.name}</p><button className="btn">Sign out</button></> : <>
        <label>Login name <input name="name" className="input" autoComplete="username" required /></label>
        <label>Password <input name="password" className="input" type="password" autoComplete="current-password" required /></label>
        <button className="btn btn-primary">Sign in</button><button value="create" className="btn">Create account</button>
        <p>Signed-out notes stay in the local workspace on this device.</p>
      </>}
    </fieldset></form>{error && <p role="alert">{error}</p>}</main>;
}
