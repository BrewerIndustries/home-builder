import { useEffect, useState } from 'react';
import { cloud, shareLink, type ShareInfo } from '../model/cloud.ts';
import { rememberedShare, rememberShare } from '../model/share.ts';
import { thumbSrc } from '../model/thumbnail.ts';

// The owner's controls for a project's read-only link: make, copy, revoke.
// The server keeps only a hash of the token, so the link can be copied again
// only on the device that made it; elsewhere, "New link" replaces it.

const when = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export function ShareControls({ projectId }: { projectId: string }) {
  const [share, setShare] = useState<ShareInfo | null | undefined>(undefined);
  const [token, setToken] = useState<string | null>(() => rememberedShare(projectId));
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    cloud.shareStatus(projectId).then(
      (s) => {
        setShare(s);
        if (!s) {
          rememberShare(projectId, null);
          setToken(null);
        }
      },
      (e) => setMsg((e as Error).message),
    );
  }, [projectId]);

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const copy = (t: string) => navigator.clipboard?.writeText(shareLink(t)).then(() => setMsg('Link copied.'), () => setMsg(shareLink(t)));

  const make = () =>
    run(async () => {
      const r = await cloud.createShare(projectId);
      rememberShare(projectId, r.token);
      setToken(r.token);
      setShare({ created_at: r.created_at });
      await copy(r.token);
    });

  const revoke = () =>
    run(async () => {
      await cloud.revokeShare(projectId);
      rememberShare(projectId, null);
      setToken(null);
      setShare(null);
      setMsg('Link turned off.');
    });

  return (
    <div className="share-box">
      {share === undefined ? (
        <span className="muted small">Checking…</span>
      ) : !share ? (
        <>
          <span className="muted small">Anyone with a read-only link can view this plan (no sign-in) and save their own copy. They can’t change yours.</span>
          <button disabled={busy} onClick={make}>
            Create link
          </button>
        </>
      ) : (
        <>
          <span className="small">Read-only link on since {when(share.created_at)}.</span>
          <div className="row">
            {token ? (
              <button disabled={busy} onClick={() => copy(token)}>
                Copy link
              </button>
            ) : (
              <button disabled={busy} onClick={make} title="The old link stops working">
                New link
              </button>
            )}
            <button className="link danger" disabled={busy} onClick={revoke}>
              Turn off
            </button>
          </div>
        </>
      )}
      {msg && <span className="muted small share-msg">{msg}</span>}
    </div>
  );
}

export function Thumb({ svg }: { svg?: string | null }) {
  return <span className="lib-thumb">{svg ? <img src={thumbSrc(svg)} alt="" loading="lazy" /> : null}</span>;
}
