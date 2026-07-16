'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';

interface TimelineStep {
  stepNo: number;
  title: string;
  description: string;
  action?: string;
  eventRefs?: string[];
}

interface SopContent {
  title: string;
  purpose: string;
  scope: string;
  prerequisites: string[];
  procedure: string[];
  decisionPoints: string[];
  exceptions: string[];
  checklist: string[];
}

interface SopData {
  sopDocumentId: string;
  workflowId: string;
  sessionId: string;
  status: string;
  sop: SopContent;
}

interface TimelineData {
  workflowId: string;
  sessionId: string;
  title: string;
  steps: TimelineStep[];
}

type RoleKey = 'contributor' | 'reviewer' | 'admin';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
const CLIENT_ID = 'acme';

const DEMO_USERS: Record<RoleKey, { email: string; password: string; label: string; hint: string }> = {
  contributor: {
    email: 'contributor@acme.test',
    password: 'demo123',
    label: 'Contributor',
    hint: 'Record & load sessions',
  },
  reviewer: {
    email: 'reviewer@acme.test',
    password: 'demo123',
    label: 'Reviewer',
    hint: 'Submit, approve, reject',
  },
  admin: {
    email: 'admin@acme.test',
    password: 'demo123',
    label: 'Admin',
    hint: 'Full review permissions',
  },
};

const STATUS_STYLES: Record<string, string> = {
  DRAFT: 'bg-slate-100 text-slate-700 ring-slate-200',
  IN_REVIEW: 'bg-amber-50 text-amber-800 ring-amber-200',
  APPROVED: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  REJECTED: 'bg-rose-50 text-rose-800 ring-rose-200',
  ARCHIVED: 'bg-zinc-100 text-zinc-600 ring-zinc-200',
};

function statusClass(status?: string) {
  if (!status) return STATUS_STYLES.DRAFT;
  return STATUS_STYLES[status] || STATUS_STYLES.DRAFT;
}

function emptySop(): SopContent {
  return {
    title: '',
    purpose: '',
    scope: '',
    prerequisites: [],
    procedure: [],
    decisionPoints: [],
    exceptions: [],
    checklist: [],
  };
}

function linesToText(lines: string[] | undefined) {
  return (lines || []).join('\n');
}

function textToLines(text: string) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function toMarkdown(sop: SopContent, status: string, sessionId: string) {
  const section = (heading: string, body: string | string[]) => {
    const content = Array.isArray(body) ? body.map((l) => `- ${l}`).join('\n') : body;
    return `## ${heading}\n\n${content || '_None_'}\n`;
  };
  return [
    `# ${sop.title || 'Untitled SOP'}`,
    '',
    `**Status:** ${status}  `,
    `**Session:** \`${sessionId}\``,
    '',
    section('Purpose', sop.purpose || ''),
    section('Scope', sop.scope || ''),
    section('Prerequisites', sop.prerequisites || []),
    '## Procedure',
    '',
    ...(sop.procedure || []).map((p, i) => {
      const line = p.replace(/^\d+\.\s*/, '');
      return `${i + 1}. ${line}`;
    }),
    '',
    section('Decision points', sop.decisionPoints || []),
    section('Exceptions', sop.exceptions || []),
    section('Checklist', sop.checklist || []),
  ].join('\n');
}

export default function SopViewerPage() {
  const [token, setToken] = useState('');
  const [userEmail, setUserEmail] = useState('');
  const [userRole, setUserRole] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [sop, setSop] = useState<SopData | null>(null);
  const [draft, setDraft] = useState<SopContent>(emptySop());
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState<{ type: 'ok' | 'err' | 'info'; text: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'document' | 'timeline' | 'advanced'>('document');
  const [jsonEdit, setJsonEdit] = useState('');
  const [showToken, setShowToken] = useState(false);

  const headers = useMemo(
    () => ({
      Authorization: `Bearer ${token}`,
      'X-Client-Id': CLIENT_ID,
      'Content-Type': 'application/json',
    }),
    [token],
  );

  const flash = useCallback((type: 'ok' | 'err' | 'info', text: string) => {
    setMessage({ type, text });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const q = new URLSearchParams(window.location.search);
    const sid = q.get('sessionId') || q.get('session');
    if (sid) setSessionId(sid);
    const saved = sessionStorage.getItem('flowmind.token');
    const email = sessionStorage.getItem('flowmind.email');
    const role = sessionStorage.getItem('flowmind.role');
    if (saved) setToken(saved);
    if (email) setUserEmail(email);
    if (role) setUserRole(role);
  }, []);

  useEffect(() => {
    if (token) sessionStorage.setItem('flowmind.token', token);
    else sessionStorage.removeItem('flowmind.token');
  }, [token]);

  async function loginAs(role: RoleKey) {
    const u = DEMO_USERS[role];
    setIsLoading(true);
    flash('info', `Signing in as ${u.label}…`);
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: u.email, password: u.password }),
      });
      const data = await res.json();
      if (!res.ok || !data.accessToken) {
        flash('err', data.message || 'Login failed');
        return;
      }
      setToken(data.accessToken);
      setUserEmail(data.user?.email || u.email);
      setUserRole(data.user?.role || role);
      sessionStorage.setItem('flowmind.email', data.user?.email || u.email);
      sessionStorage.setItem('flowmind.role', data.user?.role || role);
      flash('ok', `Signed in as ${data.user?.email || u.email}`);
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function logout() {
    setToken('');
    setUserEmail('');
    setUserRole('');
    setTimeline(null);
    setSop(null);
    setDraft(emptySop());
    sessionStorage.removeItem('flowmind.token');
    sessionStorage.removeItem('flowmind.email');
    sessionStorage.removeItem('flowmind.role');
    flash('info', 'Signed out');
  }

  async function loadSession(sid = sessionId) {
    if (!token) {
      flash('err', 'Sign in first');
      return;
    }
    if (!sid.trim()) {
      flash('err', 'Enter a session ID from the desktop recorder');
      return;
    }
    setIsLoading(true);
    flash('info', 'Loading timeline and SOP…');
    try {
      const [tlRes, sopRes] = await Promise.all([
        fetch(`${API_BASE}/agent/sessions/${sid.trim()}/timeline`, { headers }),
        fetch(`${API_BASE}/agent/sessions/${sid.trim()}/sop`, { headers }),
      ]);
      const tlData = await tlRes.json();
      const sopData = await sopRes.json();

      if (!tlRes.ok && !sopRes.ok) {
        flash('err', sopData.message || tlData.message || 'Could not load session');
        return;
      }

      setTimeline(tlData.steps ? tlData : null);

      if (sopData.sop && sopData.sopDocumentId) {
        const normalized: SopData = {
          sopDocumentId: sopData.sopDocumentId,
          workflowId: sopData.workflowId,
          sessionId: sopData.sessionId || sid.trim(),
          status: sopData.status || 'DRAFT',
          sop: {
            ...emptySop(),
            ...sopData.sop,
            prerequisites: sopData.sop.prerequisites || [],
            procedure: sopData.sop.procedure || [],
            decisionPoints: sopData.sop.decisionPoints || [],
            exceptions: sopData.sop.exceptions || [],
            checklist: sopData.sop.checklist || [],
          },
        };
        setSop(normalized);
        setDraft(normalized.sop);
        setJsonEdit(JSON.stringify(normalized.sop, null, 2));
        setActiveTab('document');
        flash('ok', `Loaded SOP (${normalized.status})`);
      } else {
        setSop(null);
        setDraft(emptySop());
        flash(
          'info',
          tlData.steps
            ? 'Timeline loaded, but no SOP draft yet. Generate one from the desktop app (Generate SOP Draft).'
            : sopData.message || 'No SOP found for this session',
        );
      }
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  function updateDraftField<K extends keyof SopContent>(key: K, value: SopContent[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
  }

  async function saveDraft() {
    if (!sop || !token) return;
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/agent/sop-documents/${sop.sopDocumentId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: draft.title, content: draft }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash('err', data.message || 'Save failed');
        return;
      }
      setSop((prev) =>
        prev
          ? {
              ...prev,
              status: data.status || prev.status,
              sop: data.sop || draft,
            }
          : prev,
      );
      if (data.sop) {
        setDraft({ ...emptySop(), ...data.sop });
        setJsonEdit(JSON.stringify(data.sop, null, 2));
      }
      flash('ok', 'SOP saved');
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  async function saveFromJson() {
    try {
      const parsed = JSON.parse(jsonEdit) as SopContent;
      setDraft({ ...emptySop(), ...parsed });
      setSop((prev) => (prev ? { ...prev, sop: { ...emptySop(), ...parsed } } : prev));
      // persist
      if (!sop || !token) return;
      setIsLoading(true);
      const res = await fetch(`${API_BASE}/agent/sop-documents/${sop.sopDocumentId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ title: parsed.title, content: parsed }),
      });
      const data = await res.json();
      if (!res.ok) {
        flash('err', data.message || 'Save failed');
        return;
      }
      setSop((prev) =>
        prev ? { ...prev, status: data.status || prev.status, sop: data.sop || parsed } : prev,
      );
      flash('ok', 'SOP saved from JSON');
      setActiveTab('document');
    } catch {
      flash('err', 'Invalid JSON — fix syntax before saving');
    } finally {
      setIsLoading(false);
    }
  }

  async function doAction(action: 'submit-review' | 'approve' | 'reject') {
    if (!sop || !token) return;
    setIsLoading(true);
    try {
      const body =
        action === 'reject' ? JSON.stringify({ reason: rejectReason || undefined }) : undefined;
      const res = await fetch(`${API_BASE}/agent/sop-documents/${sop.sopDocumentId}/${action}`, {
        method: 'POST',
        headers,
        body,
      });
      const data = await res.json();
      if (!res.ok) {
        flash('err', data.message || `${action} failed`);
        return;
      }
      flash(
        'ok',
        action === 'submit-review'
          ? 'Submitted for review'
          : action === 'approve'
            ? 'SOP approved'
            : 'SOP rejected',
      );
      await loadSession(sop.sessionId || sessionId);
    } catch (e: unknown) {
      flash('err', e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  async function copyMarkdown() {
    if (!sop) return;
    const md = toMarkdown(draft, sop.status, sop.sessionId || sessionId);
    try {
      await navigator.clipboard.writeText(md);
      flash('ok', 'Markdown copied to clipboard');
    } catch {
      flash('err', 'Could not copy — browser blocked clipboard');
    }
  }

  const canEdit = sop && (sop.status === 'DRAFT' || sop.status === 'IN_REVIEW');
  const loggedIn = !!token;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Top bar */}
      <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-indigo-600 text-sm font-bold text-white shadow-sm">
              FM
            </div>
            <div>
              <div className="text-sm font-semibold tracking-tight text-slate-900">FlowMind</div>
              <div className="text-xs text-slate-500">SOP review workbench</div>
            </div>
          </div>
          <div className="flex items-center gap-3 text-sm">
            {loggedIn ? (
              <>
                <div className="hidden text-right sm:block">
                  <div className="font-medium text-slate-800">{userEmail || 'Signed in'}</div>
                  <div className="text-xs text-slate-500">{userRole || 'session active'}</div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-slate-700 shadow-sm hover:bg-slate-50"
                >
                  Sign out
                </button>
              </>
            ) : (
              <span className="text-xs text-slate-500">Not signed in</span>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        {/* Banner message */}
        {message && (
          <div
            className={`mb-5 flex items-start justify-between gap-3 rounded-xl border px-4 py-3 text-sm ${
              message.type === 'ok'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-900'
                : message.type === 'err'
                  ? 'border-rose-200 bg-rose-50 text-rose-900'
                  : 'border-sky-200 bg-sky-50 text-sky-900'
            }`}
          >
            <p>{message.text}</p>
            <button
              type="button"
              className="shrink-0 text-xs opacity-70 hover:opacity-100"
              onClick={() => setMessage(null)}
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Setup cards */}
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          {/* Auth */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">1. Sign in</h2>
              {loggedIn && (
                <span className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-100">
                  Connected
                </span>
              )}
            </div>
            <p className="mb-4 text-sm text-slate-500">
              Use a demo account. Reviewers and admins can approve or reject SOPs.
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {(Object.keys(DEMO_USERS) as RoleKey[]).map((key) => {
                const u = DEMO_USERS[key];
                const active = userEmail === u.email;
                return (
                  <button
                    key={key}
                    type="button"
                    disabled={isLoading}
                    onClick={() => loginAs(key)}
                    className={`rounded-xl border px-3 py-3 text-left transition ${
                      active
                        ? 'border-indigo-300 bg-indigo-50 ring-2 ring-indigo-100'
                        : 'border-slate-200 bg-slate-50 hover:border-slate-300 hover:bg-white'
                    }`}
                  >
                    <div className="text-sm font-semibold text-slate-900">{u.label}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{u.hint}</div>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              className="mt-3 text-xs text-slate-400 underline-offset-2 hover:text-slate-600 hover:underline"
              onClick={() => setShowToken((v) => !v)}
            >
              {showToken ? 'Hide advanced token' : 'Advanced: paste token'}
            </button>
            {showToken && (
              <input
                type="text"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="JWT access token"
                className="mt-2 w-full rounded-lg border border-slate-200 px-3 py-2 font-mono text-xs text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
              />
            )}
          </section>

          {/* Session */}
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-base font-semibold text-slate-900">2. Open a session</h2>
            <p className="mb-4 text-sm text-slate-500">
              Paste the session ID from the desktop recorder after you generate a timeline / SOP draft.
            </p>
            <label className="mb-1 block text-xs font-medium text-slate-600">Session ID</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={sessionId}
                onChange={(e) => setSessionId(e.target.value.trim())}
                placeholder="e.g. cecaa2f6-4b2a-…"
                className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2.5 font-mono text-sm outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void loadSession();
                }}
              />
              <button
                type="button"
                disabled={isLoading || !loggedIn || !sessionId}
                onClick={() => loadSession()}
                className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isLoading ? 'Loading…' : 'Load SOP'}
              </button>
            </div>
            {!loggedIn && (
              <p className="mt-3 text-xs text-amber-700">Sign in before loading a session.</p>
            )}
          </section>
        </div>

        {/* Empty state */}
        {!sop && !timeline && (
          <section className="rounded-2xl border border-dashed border-slate-300 bg-white/60 px-6 py-14 text-center">
            <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-xl">
              📄
            </div>
            <h3 className="text-lg font-semibold text-slate-900">No SOP loaded yet</h3>
            <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
              Record a workflow in the desktop app, generate a timeline and SOP draft, then paste the
              session ID here to review it as a document.
            </p>
            <ol className="mx-auto mt-6 max-w-sm space-y-2 text-left text-sm text-slate-600">
              <li className="flex gap-2">
                <span className="font-semibold text-indigo-600">1.</span> Desktop: Login → Create →
                Start → work → Stop
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-indigo-600">2.</span> Build Timeline → Generate SOP
                Draft
              </li>
              <li className="flex gap-2">
                <span className="font-semibold text-indigo-600">3.</span> Copy session ID into this page
              </li>
            </ol>
          </section>
        )}

        {/* Main workbench */}
        {(sop || timeline) && (
          <div className="space-y-4">
            {/* Meta bar */}
            <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-lg font-semibold text-slate-900">
                    {draft.title || sop?.sop?.title || timeline?.title || 'Session workflow'}
                  </h1>
                  {sop?.status && (
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${statusClass(sop.status)}`}
                    >
                      {sop.status.replace('_', ' ')}
                    </span>
                  )}
                </div>
                <p className="mt-1 truncate font-mono text-xs text-slate-500">
                  Session {sop?.sessionId || sessionId}
                  {sop?.sopDocumentId ? ` · SOP ${sop.sopDocumentId.slice(0, 8)}…` : ''}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => loadSession()}
                  disabled={isLoading}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                >
                  Refresh
                </button>
                {sop && (
                  <button
                    type="button"
                    onClick={() => void copyMarkdown()}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50"
                  >
                    Copy Markdown
                  </button>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-1 rounded-xl bg-slate-200/60 p-1">
              {(
                [
                  ['document', 'SOP document'],
                  ['timeline', `Timeline${timeline?.steps ? ` (${timeline.steps.length})` : ''}`],
                  ['advanced', 'Advanced JSON'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setActiveTab(id)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-medium transition ${
                    activeTab === id
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Document tab */}
            {activeTab === 'document' && sop && (
              <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                <article className="space-y-5 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
                  <Field
                    label="Title"
                    disabled={!canEdit}
                    value={draft.title}
                    onChange={(v) => updateDraftField('title', v)}
                    large
                  />
                  <Field
                    label="Purpose"
                    disabled={!canEdit}
                    value={draft.purpose}
                    onChange={(v) => updateDraftField('purpose', v)}
                    multiline
                  />
                  <Field
                    label="Scope"
                    disabled={!canEdit}
                    value={draft.scope}
                    onChange={(v) => updateDraftField('scope', v)}
                    multiline
                  />
                  <ListField
                    label="Prerequisites"
                    hint="One item per line"
                    disabled={!canEdit}
                    value={linesToText(draft.prerequisites)}
                    onChange={(v) => updateDraftField('prerequisites', textToLines(v))}
                  />

                  <section>
                    <div className="mb-2 flex items-end justify-between">
                      <h3 className="text-sm font-semibold text-slate-900">Procedure</h3>
                      <span className="text-xs text-slate-400">
                        {(draft.procedure || []).length} steps · one step per line
                      </span>
                    </div>
                    {!canEdit ? (
                      <ol className="space-y-3">
                        {(draft.procedure || []).map((step, i) => (
                          <li
                            key={i}
                            className="flex gap-3 rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3"
                          >
                            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                              {i + 1}
                            </span>
                            <p className="text-sm leading-relaxed text-slate-800">
                              {step.replace(/^\d+\.\s*/, '')}
                            </p>
                          </li>
                        ))}
                      </ol>
                    ) : (
                      <textarea
                        value={linesToText(draft.procedure)}
                        onChange={(e) => updateDraftField('procedure', textToLines(e.target.value))}
                        rows={Math.min(16, Math.max(6, (draft.procedure || []).length + 2))}
                        className="w-full rounded-xl border border-slate-200 bg-slate-50/50 px-4 py-3 font-mono text-sm leading-relaxed text-slate-800 outline-none focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-100"
                      />
                    )}
                  </section>

                  <ListField
                    label="Decision points"
                    disabled={!canEdit}
                    value={linesToText(draft.decisionPoints)}
                    onChange={(v) => updateDraftField('decisionPoints', textToLines(v))}
                  />
                  <ListField
                    label="Exceptions"
                    disabled={!canEdit}
                    value={linesToText(draft.exceptions)}
                    onChange={(v) => updateDraftField('exceptions', textToLines(v))}
                  />
                  <ListField
                    label="Checklist"
                    disabled={!canEdit}
                    value={linesToText(draft.checklist)}
                    onChange={(v) => updateDraftField('checklist', textToLines(v))}
                  />
                </article>

                {/* Side panel: actions */}
                <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
                  <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                    <h3 className="mb-3 text-sm font-semibold text-slate-900">Save &amp; review</h3>
                    <button
                      type="button"
                      disabled={isLoading || !canEdit}
                      onClick={() => void saveDraft()}
                      className="mb-2 w-full rounded-xl bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Save changes
                    </button>
                    <p className="mb-4 text-xs text-slate-500">
                      {canEdit
                        ? 'Edits update the draft stored for this client.'
                        : `SOP is ${sop.status} and locked for editing.`}
                    </p>

                    <div className="space-y-2 border-t border-slate-100 pt-4">
                      <button
                        type="button"
                        disabled={isLoading || sop.status !== 'DRAFT'}
                        onClick={() => void doAction('submit-review')}
                        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                      >
                        Submit for review
                      </button>
                      <button
                        type="button"
                        disabled={isLoading || sop.status !== 'IN_REVIEW'}
                        onClick={() => void doAction('approve')}
                        className="w-full rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-40"
                      >
                        Approve
                      </button>
                      <div className="space-y-2">
                        <input
                          type="text"
                          value={rejectReason}
                          onChange={(e) => setRejectReason(e.target.value)}
                          placeholder="Reject reason (optional)"
                          className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-rose-300 focus:ring-2 focus:ring-rose-100"
                        />
                        <button
                          type="button"
                          disabled={
                            isLoading || (sop.status !== 'IN_REVIEW' && sop.status !== 'DRAFT')
                          }
                          onClick={() => void doAction('reject')}
                          className="w-full rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-900 hover:bg-rose-100 disabled:opacity-40"
                        >
                          Reject
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-xs leading-relaxed text-slate-600">
                    <p className="font-semibold text-slate-800">Review tips</p>
                    <ul className="mt-2 list-disc space-y-1 pl-4">
                      <li>Procedure should describe actions, not only open windows.</li>
                      <li>Add missing intent that Accessibility could not see.</li>
                      <li>Approve only after human review — drafts never auto-publish.</li>
                    </ul>
                  </div>
                </aside>
              </div>
            )}

            {activeTab === 'document' && !sop && timeline && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-900">
                Timeline is available, but this session has no SOP document yet. In the desktop app,
                click <strong>Generate SOP Draft</strong>, then press Refresh here.
              </div>
            )}

            {/* Timeline tab */}
            {activeTab === 'timeline' && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
                <h2 className="mb-1 text-base font-semibold text-slate-900">Captured timeline</h2>
                <p className="mb-5 text-sm text-slate-500">
                  Ordered steps from the recording session (source for the SOP procedure).
                </p>
                {!timeline?.steps?.length ? (
                  <p className="text-sm text-slate-500">No timeline steps for this session.</p>
                ) : (
                  <ol className="relative space-y-0 border-l-2 border-indigo-100 pl-6">
                    {timeline.steps.map((step, i) => (
                      <li key={i} className="relative pb-6 last:pb-0">
                        <span className="absolute -left-[1.9rem] flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-[11px] font-bold text-white">
                          {step.stepNo || i + 1}
                        </span>
                        <div className="rounded-xl border border-slate-100 bg-slate-50/80 px-4 py-3">
                          <div className="text-sm font-semibold text-slate-900">
                            {step.title || `Step ${step.stepNo || i + 1}`}
                          </div>
                          <p className="mt-1 text-sm leading-relaxed text-slate-700">
                            {step.action || step.description}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ol>
                )}
              </section>
            )}

            {/* Advanced JSON */}
            {activeTab === 'advanced' && sop && (
              <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <h2 className="mb-1 text-base font-semibold text-slate-900">Advanced JSON editor</h2>
                <p className="mb-4 text-sm text-slate-500">
                  Prefer the Document tab for normal editing. Use this only if you need bulk JSON
                  changes.
                </p>
                <textarea
                  value={jsonEdit}
                  onChange={(e) => setJsonEdit(e.target.value)}
                  rows={18}
                  disabled={!canEdit}
                  className="w-full rounded-xl border border-slate-200 bg-slate-950 px-4 py-3 font-mono text-xs leading-relaxed text-slate-100 outline-none focus:ring-2 focus:ring-indigo-300 disabled:opacity-60"
                />
                <button
                  type="button"
                  disabled={isLoading || !canEdit}
                  onClick={() => void saveFromJson()}
                  className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50"
                >
                  Validate &amp; save JSON
                </button>
              </section>
            )}
          </div>
        )}

        <footer className="mt-10 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
          FlowMind · consent-based workflow intelligence · client-isolated data · human review required
        </footer>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  multiline,
  large,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  large?: boolean;
  disabled?: boolean;
}) {
  const cls =
    'w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50 disabled:text-slate-700';
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </span>
      {multiline ? (
        <textarea
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          rows={3}
          className={cls}
        />
      ) : (
        <input
          type="text"
          value={value}
          disabled={disabled}
          onChange={(e) => onChange(e.target.value)}
          className={`${cls} ${large ? 'text-base font-semibold' : ''}`}
        />
      )}
    </label>
  );
}

function ListField({
  label,
  value,
  onChange,
  hint,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 flex items-center justify-between text-xs font-semibold uppercase tracking-wide text-slate-500">
        <span>{label}</span>
        {hint && <span className="font-normal normal-case text-slate-400">{hint}</span>}
      </span>
      <textarea
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        rows={Math.min(10, Math.max(3, value.split('\n').length + 1))}
        className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 disabled:bg-slate-50"
      />
    </label>
  );
}
