'use client';

import React, { useState } from 'react';

interface TimelineStep {
  stepNo: number;
  title: string;
  description: string;
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

export default function MinimalSopViewer() {
  const [token, setToken] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [timeline, setTimeline] = useState<TimelineData | null>(null);
  const [sop, setSop] = useState<SopData | null>(null);
  const [editContent, setEditContent] = useState('');
  const [rejectReason, setRejectReason] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const API_BASE = 'http://localhost:4000';
  const CLIENT_ID = 'acme'; // for dev header

  async function login(email: string, password: string) {
    setIsLoading(true);
    setMessage('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (data.accessToken) {
        setToken(data.accessToken);
        setMessage('Logged in successfully. Token stored.');
      } else {
        setMessage('Login failed: ' + (data.message || JSON.stringify(data)));
      }
    } catch (e: any) {
      setMessage('Login error: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function fetchTimelineAndSop() {
    if (!token || !sessionId) {
      setMessage('Token and Session ID required');
      return;
    }
    setIsLoading(true);
    setMessage('');
    try {
      const headers = {
        Authorization: `Bearer ${token}`,
        'X-Client-Id': CLIENT_ID,
      };

      const [tlRes, sopRes] = await Promise.all([
        fetch(`${API_BASE}/agent/sessions/${sessionId}/timeline`, { headers }),
        fetch(`${API_BASE}/agent/sessions/${sessionId}/sop`, { headers }),
      ]);

      const tlData = await tlRes.json();
      const sopData = await sopRes.json();

      setTimeline(tlData);
      setSop(sopData);
      if (sopData.sop) {
        setEditContent(JSON.stringify(sopData.sop, null, 2));
      }
      setMessage('Timeline and SOP loaded.');
    } catch (e: any) {
      setMessage('Fetch error: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function saveEdit() {
    if (!sop || !token) return;
    setIsLoading(true);
    try {
      let parsed;
      try {
        parsed = JSON.parse(editContent);
      } catch {
        setMessage('Invalid JSON in edit content');
        return;
      }
      const res = await fetch(`${API_BASE}/agent/sop-documents/${sop.sopDocumentId}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Client-Id': CLIENT_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content: parsed }),
      });
      const data = await res.json();
      setSop(data);
      setMessage('SOP updated (PATCH).');
      // refresh
      await fetchTimelineAndSop();
    } catch (e: any) {
      setMessage('Save error: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  }

  async function doAction(action: string) {
    if (!sop || !token) return;
    setIsLoading(true);
    setMessage('');
    try {
      let body: any = {};
      let method = 'POST';
      let url = `${API_BASE}/agent/sop-documents/${sop.sopDocumentId}/${action}`;

      if (action === 'reject' && rejectReason) {
        body = { reason: rejectReason };
      }

      const res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'X-Client-Id': CLIENT_ID,
          'Content-Type': 'application/json',
        },
        body: Object.keys(body).length ? JSON.stringify(body) : undefined,
      });
      const data = await res.json();
      setMessage(`${action} result: ${JSON.stringify(data)}`);
      // refresh sop
      await fetchTimelineAndSop();
    } catch (e: any) {
      setMessage(`${action} error: ${e.message}`);
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div style={{ padding: '20px', fontFamily: 'sans-serif', maxWidth: '900px' }}>
      <h1>Minimal SOP Viewer (Dev Workbench)</h1>
      <p style={{ color: '#666', fontSize: '14px' }}>
        Lean demo only. Enter session ID after running the backend flow. Uses X-Client-Id: acme.
        Not a production UI.
      </p>

      <div style={{ marginBottom: '20px', border: '1px solid #ccc', padding: '10px' }}>
        <h3>1. Login (demo)</h3>
        <button onClick={() => login('contributor@acme.test', 'demo123')} disabled={isLoading}>
          Login as Contributor
        </button>
        <button onClick={() => login('reviewer@acme.test', 'demo123')} disabled={isLoading} style={{ marginLeft: '8px' }}>
          Login as Reviewer
        </button>
        <button onClick={() => login('admin@acme.test', 'demo123')} disabled={isLoading} style={{ marginLeft: '8px' }}>
          Login as Admin
        </button>
        <div style={{ marginTop: '8px' }}>
          Token: <input type="text" value={token} onChange={e => setToken(e.target.value)} style={{ width: '400px' }} placeholder="Paste JWT or login above" />
        </div>
        {message && <div style={{ color: 'blue', marginTop: '8px' }}>{message}</div>}
      </div>

      <div style={{ marginBottom: '20px' }}>
        <h3>2. Load Timeline + SOP</h3>
        Session ID: <input type="text" value={sessionId} onChange={e => setSessionId(e.target.value)} style={{ width: '300px' }} placeholder="e.g. cecaa2f6-..." />
        <button onClick={fetchTimelineAndSop} disabled={isLoading || !token || !sessionId} style={{ marginLeft: '8px' }}>
          Fetch Timeline &amp; SOP
        </button>
      </div>

      {timeline && (
        <div style={{ marginBottom: '20px', border: '1px solid #ddd', padding: '10px' }}>
          <h3>Timeline</h3>
          <pre style={{ background: '#f5f5f5', padding: '8px', overflow: 'auto' }}>
            {JSON.stringify(timeline, null, 2)}
          </pre>
          <h4>Steps:</h4>
          <ol>
            {timeline.steps?.map((s, i) => (
              <li key={i}><strong>{s.title}</strong>: {s.description}</li>
            ))}
          </ol>
        </div>
      )}

      {sop && (
        <div style={{ border: '1px solid #ddd', padding: '10px' }}>
          <h3>SOP (status: {sop.status})</h3>

          <div style={{ marginBottom: '10px' }}>
            <strong>Title:</strong> {sop.sop?.title}
          </div>

          <div>
            <strong>Edit Content (JSON for sections):</strong><br />
            <textarea
              value={editContent}
              onChange={e => setEditContent(e.target.value)}
              rows={12}
              style={{ width: '100%', fontFamily: 'monospace' }}
            />
            <button onClick={saveEdit} disabled={isLoading} style={{ marginTop: '4px' }}>Save Edit (PATCH)</button>
          </div>

          <div style={{ marginTop: '16px' }}>
            <strong>Actions (requires appropriate role/permission for approve/reject):</strong><br />
            <button onClick={() => doAction('submit-review')} disabled={isLoading}>Submit for Review</button>
            <button onClick={() => doAction('approve')} disabled={isLoading} style={{ marginLeft: '8px' }}>Approve</button>
            <button onClick={() => doAction('reject')} disabled={isLoading} style={{ marginLeft: '8px' }}>Reject</button>
            <input
              type="text"
              placeholder="Optional reject reason"
              value={rejectReason}
              onChange={e => setRejectReason(e.target.value)}
              style={{ marginLeft: '8px', width: '250px' }}
            />
          </div>

          <h4 style={{ marginTop: '16px' }}>Current SOP Content:</h4>
          <pre style={{ background: '#f9f9f9', padding: '8px', whiteSpace: 'pre-wrap' }}>
            {JSON.stringify(sop.sop, null, 2)}
          </pre>
        </div>
      )}

      <p style={{ marginTop: '30px', fontSize: '12px', color: '#888' }}>
        Demo instructions: Run the backend validation flow first to create a session + SOP. Use the session ID here. 
        Login as reviewer/admin for approve/reject actions.
      </p>
    </div>
  );
}
