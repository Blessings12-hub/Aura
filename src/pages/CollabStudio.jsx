import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  collection, addDoc, query, orderBy, onSnapshot, Timestamp,
  doc, setDoc, onSnapshot as onDocSnap, deleteDoc, getDocs, writeBatch,
} from 'firebase/firestore';
import { Eraser, Undo2, Brush } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

export default function CollabStudio() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { user, userId, loading } = useCurrentUser();
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const cursorThrottle = useRef(0);
  const [color, setColor] = useState('#6366f1');
  const [size, setSize] = useState(5);
  const [strokes, setStrokes] = useState([]);
  const [cursors, setCursors] = useState({});

  // Canvas resize
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return undefined;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  // Subscribe strokes
  useEffect(() => {
    const q = query(collection(db, 'collabStudio'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (s) => setStrokes(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, []);

  // Subscribe cursors (live presence)
  useEffect(() => {
    return onSnapshot(collection(db, 'collabCursors'), (s) => {
      const c = {};
      s.docs.forEach((d) => {
        const data = d.data();
        if (d.id !== userId && data.ts && (Date.now() - (data.ts || 0)) < 8000) c[d.id] = data;
      });
      setCursors(c);
    });
  }, [userId]);

  // Redraw on stroke changes
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    strokes.forEach((stroke) => {
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
    await addDoc(collection(db, 'collabStudio'), {
      userId, userColor: user?.avatarColor, color, size, points, createdAt: Timestamp.now(),
    });
  };

  const clearAll = async () => {
    const snap = await getDocs(collection(db, 'collabStudio'));
    const batch = writeBatch(db);
    snap.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
  };

  const undoMine = async () => {
    const mine = strokes.filter((s) => s.userId === userId);
    const last = mine[mine.length - 1];
    if (last) await deleteDoc(doc(db, 'collabStudio', last.id));
  };

  if (loading || !user) return <div className=\"aura-page\"><div className=\"aura-shell\"><div className=\"aura-card\">{t('loading')}</div></div></div>;

  return (
    <div className=\"aura-page\">
      <div className=\"aura-shell\">
        <TopBar title={t('collab_studio')} subtitle={t('canvas_strokes', { n: strokes.length })} onBack={() => navigate(-1)} />

        <div className=\"aura-card aura-section fade-in\">
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
              data-testid=\"collab-canvas\"
              style={{
                width: '100%', height: 460, borderRadius: 14, border: '1px solid var(--border)',
                cursor: 'crosshair', touchAction: 'none', display: 'block',
                background: 'var(--surface-2)',
              }}
              aria-label=\"Shared drawing canvas\"
            />
            {Object.entries(cursors).map(([uid, c]) => {
              const rect = canvasRef.current?.getBoundingClientRect();
              if (!rect) return null;
              return (
                <div key={uid} style={{ position: 'absolute', left: c.x * 100 + '%', top: c.y * 100 + '%' }} className=\"canvas-cursor\" >
                  <span className=\"canvas-name\" style={{ background: c.color }}>{c.name}</span>
                </div>
              );
            })}
          </div>

          <div className=\"canvas-toolbar\">
            <label className=\"chip\"><Brush size={12} /> {t('canvas_color')}
              <input type=\"color\" value={color} onChange={(e) => setColor(e.target.value)} style={{ width: 28, height: 22, border: 'none', background: 'transparent', cursor: 'pointer' }} data-testid=\"color-picker\" />
            </label>
            <label className=\"chip\">{t('canvas_size')} <input type=\"range\" min=\"1\" max=\"30\" value={size} onChange={(e) => setSize(Number(e.target.value))} data-testid=\"size-range\" /> <span>{size}</span></label>
            <button type=\"button\" onClick={undoMine} className=\"aura-btn aura-btn-secondary aura-btn-pill\" data-testid=\"undo-btn\"><Undo2 size={14} /> {t('canvas_undo')}</button>
            <button type=\"button\" onClick={clearAll} className=\"aura-btn aura-btn-danger aura-btn-pill\" data-testid=\"clear-btn\"><Eraser size={14} /> {t('canvas_clear')}</button>
          </div>

          <p className=\"aura-muted\" style={{ fontSize: '0.85rem', margin: 0 }}>
            {Object.keys(cursors).length > 0 ? `${Object.keys(cursors).length} other drawer(s) live` : 'You’re the only one here — share the link to invite a friend.'}
          </p>
        </div>
      </div>
    </div>
  );
}