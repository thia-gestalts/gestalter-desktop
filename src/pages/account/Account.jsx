import { useEffect, useState } from 'react';
import { account } from '../../entities/workspace/storage';

function SyncStatus() {
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
  return <p role="status" className="text-sm text-base-content/70">{status}</p>;
}

export function Account() {
  const [client, setClient] = useState();
  const [signup, setSignup] = useState(false);
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
      else await client.login(data.get('name'), data.get('password'), signup);
    } catch (failure) {
      setError(failure.message);
      setBusy(false);
    }
  }
  return <main className="flex flex-1 items-start justify-center p-6">
    <form onSubmit={submit} className="w-full max-w-sm">
      <fieldset disabled={busy || !client} className="flex flex-col gap-3">
        <h1 className="text-lg font-semibold">{client?.session ? 'Olymp account' : signup ? 'Create account' : 'Sign in'}</h1>
        {client?.session ? <>
          <p>{client.session.account.name}</p><SyncStatus /><button className="btn">Sign out</button>
        </> : <>
          <label>Login name <input name="name" className="input w-full" autoComplete="username" required /></label>
          <label>Password <input key={String(signup)} name="password" className="input w-full" type="password"
            autoComplete={signup ? 'new-password' : 'current-password'} required /></label>
          <button className="btn btn-primary">{signup ? 'Create account' : 'Sign in'}</button>
          <button type="button" className="btn btn-ghost" onClick={() => {
            setError('');
            setSignup(!signup);
          }}>{signup ? 'Sign in instead' : 'Create account'}</button>
        </>}
      </fieldset>
      {error && <p role="alert" className="text-error">{error}</p>}
    </form>
  </main>;
}
