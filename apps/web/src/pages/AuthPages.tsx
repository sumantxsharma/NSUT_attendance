import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { APP_NAME, APP_SUBTITLE } from '@nsut/shared';
import { api } from '../lib/api';
import { useAuth, usePublicSettings } from '../lib/auth';
import { Button, Field, FormError } from '../components/ui';

function AuthShell({ children, title, subtitle }: { children: ReactNode; title: string; subtitle?: string }) {
  const { data } = usePublicSettings();
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="hidden flex-col justify-between bg-ink-800 p-10 text-white lg:flex">
        <div className="flex items-center gap-3">
          {data?.hasLogo ? (
            <img src={`/api/settings/logo?v=${data.logoVersion}`} alt="University logo" className="h-12 w-12 rounded bg-white object-contain p-1" />
          ) : (
            <span className="inline-flex h-12 w-12 items-center justify-center rounded border border-dashed border-white/40 text-[9px] font-semibold uppercase tracking-wider text-white/60" aria-label="Logo placeholder">
              Logo
            </span>
          )}
          <div>
            <p className="text-sm font-semibold">{data?.universityName ?? 'Netaji Subhas University of Technology, Delhi'}</p>
            <p className="text-xs text-[#9FB0C8]">{data?.unitName}</p>
          </div>
        </div>
        <div className="max-w-md">
          <h1 className="text-[34px] font-semibold leading-tight text-white">{APP_NAME}</h1>
          <p className="mt-2 text-lg text-[#C9D2E0]">{APP_SUBTITLE}</p>
          <ul className="mt-8 space-y-3 text-sm text-[#C9D2E0]">
            <li>— Daily presence with in-time, out-time and duration</li>
            <li>— Leave requests with approval trail</li>
            <li>— Monthly attendance calculated from records, never typed in</li>
            <li>— Every correction recorded with a reason</li>
          </ul>
        </div>
        <p className="text-xs text-[#7F91AD]">Authorised users only. Activity on this system is logged.</p>
      </div>
      <div className="flex items-center justify-center bg-canvas px-4 py-10">
        <div className="w-full max-w-[400px]">
          <div className="mb-6 lg:hidden">
            <p className="text-lg font-semibold text-ink">{APP_NAME}</p>
            <p className="text-sm text-muted">{APP_SUBTITLE}</p>
          </div>
          <div className="panel p-6 sm:p-7">
            <h2 className="text-xl font-semibold">{title}</h2>
            {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
            <div className="mt-5">{children}</div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { me, login, sessionExpired } = useAuth();
  const settings = usePublicSettings();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  if (me) return <Navigate to={me.role === 'STAFF' ? '/me' : (loc.state?.from ?? '/')} replace />;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const u = await login(email, password);
      nav(u.role === 'STAFF' ? '/me' : (loc.state?.from ?? '/'), { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };
  return (
    <AuthShell title="Sign in" subtitle="Use your institutional account.">
      {sessionExpired && <p className="mb-4 rounded border border-[#EFD9A8] bg-st-leaveBg px-3 py-2 text-sm text-st-leave">Your session has expired. Please sign in again.</p>}
      <form onSubmit={submit} className="space-y-4" noValidate>
        <Field label="Email">
          {(p) => <input {...p} type="email" autoComplete="username" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}
        </Field>
        <Field label="Password">
          {(p) => <input {...p} type="password" autoComplete="current-password" required className="input" value={password} onChange={(e) => setPassword(e.target.value)} />}
        </Field>
        <FormError error={error} />
        <Button type="submit" variant="primary" className="w-full" loading={busy}>
          Sign in
        </Button>
        <p className="text-center text-sm">
          <Link to="/forgot-password">Forgot password?</Link>
        </p>
      </form>
      {settings.data?.demoMode && (
      <details className="mt-6 border-t border-line pt-4 text-xs text-muted">
        <summary className="cursor-pointer font-medium text-ink">Demo accounts</summary>
        <p className="mt-2">Password for all demo accounts: <code className="kbd">Demo@12345</code></p>
        <ul className="mt-2 space-y-1">
          {[
            ['superadmin@demo.invalid', 'Super Admin'],
            ['officer@demo.invalid', 'Authorized Officer'],
            ['coordinator.field@demo.invalid', 'Coordinator (Athletics, Football)'],
            ['coordinator.sports@demo.invalid', 'Coordinator (Sports)'],
            ['gf01.kavya@demo.invalid', 'Guest Faculty'],
            ['coach01.rajesh@demo.invalid', 'Sports Coach'],
          ].map(([e, r]) => (
            <li key={e}>
              <button type="button" className="text-left text-brand-700 hover:underline" onClick={() => { setEmail(e); setPassword('Demo@12345'); }}>
                {e}
              </button>{' '}
              — {r}
            </li>
          ))}
        </ul>
      </details>
      )}
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [result, setResult] = useState<{ message: string; devResetUrl?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Reset password" subtitle="We’ll send a reset link to your registered email.">
      {result ? (
        <div className="space-y-3 text-sm">
          <p role="status">{result.message}</p>
          {result.devResetUrl && (
            <p className="rounded border border-dashed border-line bg-[#FAFBFC] p-3 text-xs text-muted">
              Development mode — email delivery is not configured, so the link is shown here:{' '}
              <a href={result.devResetUrl.replace(/^https?:\/\/[^/]+/, '')} className="break-all">
                Open reset link
              </a>
            </p>
          )}
          <Link to="/login">Back to sign in</Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError(null);
            try {
              setResult(await api.post('/auth/password/forgot', { email }));
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field label="Email">{(p) => <input {...p} type="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <FormError error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy}>
            Send reset link
          </Button>
          <p className="text-center text-sm">
            <Link to="/login">Back to sign in</Link>
          </p>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const mismatch = pw2.length > 0 && pw !== pw2;
  return (
    <AuthShell title="Choose a new password" subtitle="At least 10 characters, with letters and numbers.">
      {done ? (
        <div className="space-y-3 text-sm">
          <p role="status">{done}</p>
          <Link to="/login" className="btn-primary no-underline">
            Sign in
          </Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            if (mismatch) return;
            setBusy(true);
            setError(null);
            try {
              const r = await api.post<{ message: string }>('/auth/password/reset', { token, password: pw });
              setDone(r.message);
            } catch (err) {
              setError(err);
            } finally {
              setBusy(false);
            }
          }}
        >
          {!token && <FormError error="This reset link is missing its token. Please request a new link." />}
          <Field label="New password">{(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={pw} onChange={(e) => setPw(e.target.value)} />}</Field>
          <Field label="Confirm new password" error={mismatch ? 'Passwords do not match.' : undefined}>
            {(p) => <input {...p} type="password" autoComplete="new-password" className="input" value={pw2} onChange={(e) => setPw2(e.target.value)} />}
          </Field>
          <FormError error={error} />
          <Button type="submit" variant="primary" className="w-full" loading={busy} disabled={!token || mismatch || pw.length < 10}>
            Set password
          </Button>
        </form>
      )}
    </AuthShell>
  );
}
