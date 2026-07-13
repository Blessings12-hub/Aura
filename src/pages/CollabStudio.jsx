import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
  doc, setDoc, deleteDoc, getDocs, writeBatch,
} from 'firebase/firestore';
import {
  Eraser, Undo2, Brush, Send, MessageCircle, X,
} from 'lucide-react';
import { db } from '../firebase';
import { subscribe } from '../lib/subscribe';
import { useCurrentUser } from '../hooks/useCurrentUser';
import { useBlockedUsers } from '../hooks/useBlockedUsers';
import TopBar from '../components/TopBar';
import Avatar from '../components/Avatar';

export default function CollabStudio() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const blockedUsers = useBlockedUsers(userId);
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const cursorThrottle = useRef(0);
  const [color, setColor] = useState('#6366f1');
  const [size, setSize] = useState(5);
  const [strokes, setStrokes] = useState([]);
  const [cursors, setCursors] = useState({});
  const [loadError, setLoadError] = useState('');

  // Live chat alongside the shared canvas — one room, since there's one
  // shared board. Same pattern as Mood Chat: a flat collection, ordered by
  // createdAt, with a scroll-to-bottom on new messages.
  const [chatOpen, setChatOpen] = useState(true);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatText, setChatText] = useState('');
  const [chatError, setChatError] = useState('');
  const chatListRef = useRef(null);

  useEffect(() => {
    const q = query(collection(db, 'collabChatMessages'), orderBy('createdAt', 'asc'));
    return subscribe(
      q,
      (snap) => {
        setChatMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
        requestAnimationFrame(() => {
          if (chatListRef.current) chatListRef.current.scrollTop = chatListRef.current.scrollHeight;
        });
      },
      (err) => setChatError(`Chat could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'collab studio chat',
    );
  }, []);

  const sendChat = async () => {
    if (!chatText.trim() || !userId) return;
    try {
      await addDoc(collection(db, 'collabChatMessages'), {
        text: chatText.trim(), userId, userColor: user?.avatarColor, createdAt: Timestamp.now(),
      });
      setChatText('');
    } catch (err) {
      setChatError(`Couldn't send that. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  // Single source of truth for painting all strokes, so both "strokes
  // changed" and "canvas just resized" redraw through the same logic.
  const redrawAll = (strokesToDraw) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    strokesToDraw.forEach((stroke) => {
      const pts = stroke.points || [];
      ctx.strokeStyle = stroke.color || '#000';
      ctx.lineWidth = stroke.size || 4;
      ctx.beginPath();
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]; const b = pts[i];
        ctx.moveTo(a.x * rect.width, a.y * rect.height);
        ctx.lineTo(b.x * rect.width, b.y * rect.height);
      }
      ctx.stroke();
    });
  };
  const strokesRef = useRef([]);
  useEffect(() => { strokesRef.current = strokes; }, [strokes]);

  // Canvas resize — ResizeObserver instead of only window 'resize'. This
  // matters specifically on mobile: window.resize does not reliably fire
  // when a mobile browser's address bar collapses/expands on scroll (a
  // documented cross-browser inconsistency), which can leave the canvas's
  // internal bitmap calibrated against a stale size. ResizeObserver watches
  // the element's actual rendered box directly, regardless of what caused
  // the change.
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return undefined;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return; // not laid out yet
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      redrawAll(strokesRef.current);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Subscribe strokes
  useEffect(() => {
    const q = query(collection(db, 'collabStudio'), orderBy('createdAt', 'asc'));
    return subscribe(
      q,
      (s) => setStrokes(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (err) => setLoadError(`The canvas could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'collab studio strokes',
    );
  }, []);

  // Subscribe cursors (live presence)
  useEffect(() => {
    return subscribe(
      collection(db, 'collabCursors'),
      (s) => {
        const c = {};
        s.docs.forEach((d) => {
          const data = d.data();
          if (d.id !== userId && data.ts && (Date.now() - (data.ts || 0)) < 8000) c[d.id] = data;
        });
        setCursors(c);
      },
      (err) => setLoadError(`Live cursors could not be loaded. (${err?.code || 'unknown'}: ${err?.message || err})`),
      'collab studio cursors',
    );
  }, [userId]);

  // Redraw whenever the strokes list itself changes (new stroke arrived,
  // one was undone/cleared).
  useEffect(() => {
    redrawAll(strokes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes]);

  const getPoint = (e) => {
    const canvas = canvasRef.current; if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cx = e.touches ? e.touches[0].clientX : e.clientX;
    const cy = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: (cx - rect.left) / rect.width, y: (cy - rect.top) / rect.height };
  };

  const drawSegment = (from, to) => {
    const canvas = canvasRef.current; if (!canvas || !from || !to) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = color; ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(from.x * rect.width, from.y * rect.height);
    ctx.lineTo(to.x * rect.width, to.y * rect.height);
    ctx.stroke();
  };

  const updateCursor = async (point) => {
    if (!userId) return;
    const now = Date.now();
    if (now - cursorThrottle.current < 80) return;
    cursorThrottle.current = now;
    try {
      await setDoc(doc(db, 'collabCursors', userId), {
        x: point.x, y: point.y, color: user?.avatarColor || color, name: userId.slice(0, 6), ts: now,
      }, { merge: true });
    } catch {}
  };

  const handleStart = (e) => { e.preventDefault(); const p = getPoint(e); if (!p) return; drawingRef.current = true; currentStrokeRef.current = [p]; updateCursor(p); };
  const handleMove = (e) => {
    e.preventDefault();
    const p = getPoint(e); if (!p) return;
    updateCursor(p);
    if (!drawingRef.current) return;
    const prev = currentStrokeRef.current[currentStrokeRef.current.length - 1];
    drawSegment(prev, p);
    currentStrokeRef.current.push(p);
  };
  const handleEnd = async () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = currentStrokeRef.current;
    currentStrokeRef.current = [];
    if (points.length < 2 || !userId) return;
    try {
      await addDoc(collection(db, 'collabStudio'), {
        userId, userColor: user?.avatarColor, color, size, points, createdAt: Timestamp.now(),
      });
    } catch (err) {
      // Important one to catch: without this, a failed save meant your
      // stroke visually disappeared with zero explanation the moment you
      // lifted your finger/mouse — about as "demo-broken" as it gets.
      setLoadError(`Your last stroke didn't save. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const clearAll = async () => {
    try {
      const snap = await getDocs(collection(db, 'collabStudio'));
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
    } catch (err) {
      setLoadError(`Couldn't clear the canvas. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  const undoMine = async () => {
    try {
      const mine = strokes.filter((s) => s.userId === userId);
      const last = mine[mine.length - 1];
      if (last) await deleteDoc(doc(db, 'collabStudio', last.id));
    } catch (err) {
      setLoadError(`Couldn't undo. (${err?.code || 'unknown'}: ${err?.message || err})`);
    }
  };

  if (loading || !user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">{t('loading')}</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title={t('collab_studio')}
          subtitle={t('draw_and_chat')}
          onBack={() => navigate(-1)}
          right={
            <button
              type="button"
              onClick={() => setChatOpen((v) => !v)}
              className="aura-btn aura-btn-secondary aura-btn-pill"
              data-testid="collab-chat-toggle"
              aria-label={chatOpen ? t('hide_chat') : t('show_chat')}
              title={chatOpen ? t('hide_chat') : t('show_chat')}
            >
              {chatOpen ? <X size={14} /> : <MessageCircle size={14} />}
            </button>
          }
        />
        {loadError && <p className="aura-login-error" data-testid="collab-load-error">{loadError}</p>}
        {chatError && <p className="aura-login-error" data-testid="collab-chat-error">{chatError}</p>}

        <div className={`aura-card aura-section fade-in collab-layout${chatOpen ? '' : ' collab-layout--chat-hidden'}`}>
          <div className="collab-canvas-col">
            <div ref={wrapRef} style={{ position: 'relative' }}>
              <canvas
                ref={canvasRef}
                onMouseDown={handleStart}
                onMouseMove={handleMove}
                onMouseUp={handleEnd}
                onMouseLeave={handleEnd}
                onTouchStart={handleStart}
                onTouchMove={handleMove}
                onTouchEnd={handleEnd}
                data-testid="collab-canvas"
                style={{
                  width: '100%', height: 460, borderRadius: 14, border: '1px solid var(--border)',
                  cursor: 'crosshair', touchAction: 'none', display: 'block',
                  background: 'var(--surface-2)',
                }}
                aria-label="Shared drawing canvas"
              />
              {Object.entries(cursors).map(([uid, c]) => {
                const rect = canvasRef.current?.getBoundingClientRect();
                if (!rect) return null;
                return (
                  <div key={uid} style={{ position: 'absolute', left: c.x * 100 + '%', top: c.y * 100 + '%' }} className="canvas-cursor" >
                    <span className="canvas-name" style={{ background: c.color }}>{c.name}</span>
                  </div>
                );
              })}
            </div>

            <div className="canvas-toolbar">
              <label className="chip"><Brush size={12} /> {t('canvas_color')}
                <input type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 28, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }} data-testid="color-picker" />
              </label>
              <label className="chip">{t('canvas_size')} <input type="range" min="1" max="30" value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid="size-range" /> <span>{size}</span></label>
              <button type="button" onClick={undoMine} className="aura-btn aura-btn-secondary aura-btn-pill" data-testid="undo-btn"><Undo2 size={14} /> {t('canvas_undo')}</button>
              <button type="button" onClick={clearAll} className="aura-btn aura-btn-danger aura-btn-pill" data-testid="clear-btn"><Eraser size={14} /> {t('canvas_clear')}</button>
            </div>

            <p className="aura-muted" style={{ fontSize: '0.85rem', margin: 0 }}>
              {Object.keys(cursors).length > 0 ? `${Object.keys(cursors).length} other drawer(s) live` : 'You’re the only one here — share the link to invite a friend.'}
            </p>
          </div>

          {chatOpen && (
            <div className="collab-chat-col" data-testid="collab-chat-panel">
              <div ref={chatListRef} className="message-list collab-chat-list" data-testid="collab-chat-list">
                {chatMessages.filter((m) => !blockedUsers.has(m.userId)).length === 0 ? (
                  <p className="aura-muted" style={{ textAlign: 'center', padding: '1.5rem 0.5rem' }}>{t('no_messages')}</p>
                ) : chatMessages.filter((m) => !blockedUsers.has(m.userId)).map((m) => (
                  <div key={m.id} className={`message${m.userId === userId ? ' message--mine' : ''}`} data-testid={`collab-msg-${m.id}`}>
                    <div className="aura-row" style={{ gap: 6 }}>
                      <Avatar color={m.userColor} size={18} />
                      <span className="message__meta">Person {m.userId?.slice(0, 6)}</span>
                    </div>
                    <div className="message__bubble">{m.text}</div>
                  </div>
                ))}
              </div>
              <div className="aura-row" style={{ marginTop: 8 }}>
                <input
                  type="text"
                  className="aura-input"
                  placeholder={t('type_message')}
                  value={chatText}
                  onChange={(e) => setChatText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') sendChat(); }}
                  style={{ flex: '1 1 160px' }}
                  data-testid="collab-chat-input"
                />
                <button type="button" onClick={sendChat} disabled={!chatText.trim()} className="aura-btn aura-btn-primary" data-testid="collab-chat-send"><Send size={16} /></button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}