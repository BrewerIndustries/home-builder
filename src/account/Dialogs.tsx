import { useEffect, useState, type FormEvent } from 'react';
import { cloud, inviteLink, type CloudProject, type Invite, type User } from '../model/cloud.ts';
import { listLocal } from '../model/library.ts';
import { Modal } from '../ui/Modal.tsx';
import type { Workspace } from './useWorkspace.ts';

// Project library and account dialogs.

const when = (t: number) => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const size = (b: number) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

export function ProjectsDialog({ ws, onClose, onSignIn }: { ws: Workspace; onClose(): void; onSignIn(): void }) {
  const [local, setLocal] = useState<{ id: string; name: string; updatedAt: number }[] | null>(null);
  const [remote, setRemote] = useState<CloudProject[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () => {
    listLocal().then(setLocal, () => setLocal([]));
    if (ws.user) cloud.list().then(setRemote, (e) => setError(e.message));
  };
  useEffect(refresh, [ws.user]);

  async function run(fn: () => Promise<void>, close = false) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) onClose();
      else refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const isOpen = (source: 'local' | 'cloud', id: string) => ws.current.source === source && ws.current.id === id;
  const confirmDelete = (name: string) => confirm(`Delete “${name}”? This can’t be undone.`);

  return (
    <Modal title="Projects" onClose={onClose}>
      {error && <p className="banner error">{error}</p>}
      <section className="lib">
        <div className="lib-head">
          <h3>Your account</h3>
          {ws.user && (
            <button disabled={busy} onClick={() => run(() => ws.create('cloud'), true)}>
              + New in account
            </button>
          )}
        </div>
        {!ws.user ? (
          <p className="muted">
            {ws.user === undefined ? 'Checking sign-in…' : 'Sign in to keep projects in your account and open them on any device. '}
            {ws.user === null && (
              <button className="link" onClick={onSignIn}>
                Sign in
              </button>
            )}
          </p>
        ) : !remote ? (
          <p className="muted">Loading…</p>
        ) : !remote.length ? (
          <p className="muted">No projects in your account yet. Start one, or move one from this device.</p>
        ) : (
          <ul className="lib-list">
            {remote.map((p) => (
              <li key={p.id} className={isOpen('cloud', p.id) ? 'open' : ''}>
                <button className="lib-name" disabled={busy || isOpen('cloud', p.id)} onClick={() => run(() => ws.open('cloud', p.id), true)}>
                  {p.name}
                  {isOpen('cloud', p.id) && <span className="badge">open</span>}
                </button>
                <span className="muted small">
                  {when(p.updated_at)} · {size(p.bytes)}
                </span>
                <button className="link danger" disabled={busy} onClick={() => confirmDelete(p.name) && run(() => ws.remove('cloud', p.id))}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="lib">
        <div className="lib-head">
          <h3>This device</h3>
          <button disabled={busy} onClick={() => run(() => ws.create('local'), true)}>
            + New on this device
          </button>
        </div>
        {!local ? (
          <p className="muted">Loading…</p>
        ) : !local.length ? (
          <p className="muted">Nothing saved only on this device.</p>
        ) : (
          <ul className="lib-list">
            {local.map((p) => (
              <li key={p.id} className={isOpen('local', p.id) ? 'open' : ''}>
                <button className="lib-name" disabled={busy || isOpen('local', p.id)} onClick={() => run(() => ws.open('local', p.id), true)}>
                  {p.name}
                  {isOpen('local', p.id) && <span className="badge">open</span>}
                </button>
                <span className="muted small">{when(p.updatedAt)}</span>
                {ws.user && (
                  <button className="link" disabled={busy} onClick={() => run(() => ws.moveToAccount(p.id))} title="Upload to your account and remove it from this device">
                    Move to account
                  </button>
                )}
                <button className="link danger" disabled={busy} onClick={() => confirmDelete(p.name) && run(() => ws.remove('local', p.id))}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="muted small">Saved in this browser only. Clearing site data removes them. Use File → Save project file for a backup.</p>
      </section>
    </Modal>
  );
}

export function AccountDialog({ ws, onClose, invite }: { ws: Workspace; onClose(): void; invite?: string }) {
  if (ws.user) return <AccountPanel ws={ws} user={ws.user} onClose={onClose} />;
  return <SignIn ws={ws} onClose={onClose} invite={invite} />;
}

function SignIn({ ws, onClose, invite }: { ws: Workspace; onClose(): void; invite?: string }) {
  const [mode, setMode] = useState<'login' | 'signup'>(invite ? 'signup' : 'login');
  const [code, setCode] = useState(invite ?? '');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      ws.setUser(mode === 'login' ? await cloud.login(email, password) : await cloud.signup(code, email, password, name));
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={mode === 'login' ? 'Sign in' : 'Create your account'} onClose={onClose}>
      <form className="auth-form" onSubmit={submit}>
        {mode === 'signup' && (
          <label className="field">
            <span>Invite code</span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="ABCD-EFGH-JKLM" required autoComplete="off" />
          </label>
        )}
        <label className="field">
          <span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="email" autoFocus />
        </label>
        {mode === 'signup' && (
          <label className="field">
            <span>Name (optional)</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />
          </label>
        )}
        <label className="field">
          <span>Password{mode === 'signup' && ' (10+ characters)'}</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={mode === 'signup' ? 10 : undefined}
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
          />
        </label>
        {error && <p className="warn-text">{error}</p>}
        <button className="primary" disabled={busy}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        <p className="muted small">
          {mode === 'login' ? (
            <>
              Accounts are invite-only.{' '}
              <button type="button" className="link" onClick={() => setMode('signup')}>
                I have an invite code
              </button>
            </>
          ) : (
            <button type="button" className="link" onClick={() => setMode('login')}>
              I already have an account
            </button>
          )}
        </p>
        <p className="muted small">You don’t need an account — projects can stay on this device.</p>
      </form>
    </Modal>
  );
}

function AccountPanel({ ws, user, onClose }: { ws: Workspace; user: User; onClose(): void }) {
  const [invites, setInvites] = useState<Invite[] | null>(null);
  const [note, setNote] = useState('');
  const [fresh, setFresh] = useState<string | null>(null);
  const [pw, setPw] = useState({ current: '', next: '' });
  const [msg, setMsg] = useState<string | null>(null);
  const admin = user.role === 'admin';

  const load = () => {
    if (admin) cloud.invites().then(setInvites, (e) => setMsg(e.message));
  };
  useEffect(load, [admin]);

  async function mint() {
    try {
      const code = await cloud.invite(note);
      setFresh(code);
      setNote('');
      load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function changePassword(e: FormEvent) {
    e.preventDefault();
    try {
      await cloud.changePassword(pw.current, pw.next);
      setPw({ current: '', next: '' });
      setMsg('Password changed.');
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <Modal title="Account" onClose={onClose}>
      <p>
        Signed in as <strong>{user.display_name || user.email}</strong>
        {user.display_name && <span className="muted"> · {user.email}</span>}
        {admin && <span className="badge">admin</span>}
      </p>
      {msg && <p className="muted">{msg}</p>}
      {admin && (
        <section className="lib">
          <h3>Invite someone</h3>
          <div className="row">
            <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Who is it for? (optional)" />
            <button onClick={mint}>Create invite</button>
          </div>
          {fresh && (
            <div className="invite-fresh">
              <code>{fresh}</code>
              <button onClick={() => navigator.clipboard?.writeText(inviteLink(fresh)).then(() => setMsg('Invite link copied.'))}>Copy link</button>
            </div>
          )}
          {invites && invites.length > 0 && (
            <table className="mini">
              <tbody>
                {invites.map((i) => (
                  <tr key={i.code}>
                    <td>
                      <code>{i.code}</code>
                      {i.note && <span className="muted"> · {i.note}</span>}
                    </td>
                    <td className="num">
                      {i.used_by_email ? (
                        <span className="muted">used by {i.used_by_email}</span>
                      ) : (
                        <button className="link danger" onClick={() => cloud.revokeInvite(i.code).then(load)}>
                          Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <small className="muted">Each code works once. Send the link; it opens the sign-up form with the code filled in.</small>
        </section>
      )}
      <section className="lib">
        <h3>Change password</h3>
        <form className="auth-form" onSubmit={changePassword}>
          <input type="password" placeholder="Current password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} autoComplete="current-password" required />
          <input type="password" placeholder="New password (10+ characters)" minLength={10} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} autoComplete="new-password" required />
          <button>Change password</button>
        </form>
      </section>
      <button
        onClick={async () => {
          await ws.signOut();
          onClose();
        }}
      >
        Sign out
      </button>
    </Modal>
  );
}
