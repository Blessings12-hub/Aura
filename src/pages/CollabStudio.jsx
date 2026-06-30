import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  collection,
  addDoc,
  query,
  orderBy,
  onSnapshot,
  Timestamp
} from 'firebase/firestore';
import { Eraser } from 'lucide-react';
import { db } from '../firebase';
import { useCurrentUser } from '../hooks/useCurrentUser';
import TopBar from '../components/TopBar';

export default function CollabStudio() {
  const navigate = useNavigate();
  const { user, userId, loading } = useCurrentUser();
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const currentStrokeRef = useRef([]);
  const [color, setColor] = useState('#4F46E5');
  const [size, setSize] = useState(4);
  const [strokes, setStrokes] = useState([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;

      const ctx = canvas.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  useEffect(() => {
    const q = query(collection(db, 'collabStudio'), orderBy('createdAt', 'asc'));
    return onSnapshot(q, (snap) => {
      setStrokes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);

    strokes.forEach((stroke) => {
      const pts = stroke.points || [];
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        ctx.strokeStyle = stroke.color || '#000';
        ctx.lineWidth = stroke.size || 4;
        ctx.beginPath();
        ctx.moveTo(a.x * rect.width, a.y * rect.height);
        ctx.lineTo(b.x * rect.width, b.y * rect.height);
        ctx.stroke();
      }
    });
  }, [strokes]);

  const getPoint = (e) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;

    const rect = canvas.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    return {
      x: (clientX - rect.left) / rect.width,
      y: (clientY - rect.top) / rect.height
    };
  };

  const drawSegment = (from, to) => {
    const canvas = canvasRef.current;
    if (!canvas || !from || !to) return;

    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(from.x * rect.width, from.y * rect.height);
    ctx.lineTo(to.x * rect.width, to.y * rect.height);
    ctx.stroke();
  };

  const handleStart = (e) => {
    e.preventDefault();
    const point = getPoint(e);
    if (!point) return;
    drawingRef.current = true;
    currentStrokeRef.current = [point];
  };

  const handleMove = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();

    const point = getPoint(e);
    if (!point) return;

    const prev = currentStrokeRef.current[currentStrokeRef.current.length - 1];
    drawSegment(prev, point);
    currentStrokeRef.current.push(point);
  };

  const handleEnd = async () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;

    const points = currentStrokeRef.current;
    currentStrokeRef.current = [];

    if (points.length < 2 || !userId) return;

    await addDoc(collection(db, 'collabStudio'), {
      userId,
      userColor: user?.avatarColor,
      color,
      size,
      points,
      createdAt: Timestamp.now()
    });
  };

  if (loading || !user) {
    return (
      <div className="aura-page">
        <div className="aura-shell">
          <div className="aura-card">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Collab Studio"
          subtitle="Draw together on a shared canvas. Resets every 24 hours."
          onBack={() => navigate(-1)}
        />

        <div className="aura-card aura-section">
          <canvas
            ref={canvasRef}
            onMouseDown={handleStart}
            onMouseMove={handleMove}
            onMouseUp={handleEnd}
            onMouseLeave={handleEnd}
            onTouchStart={handleStart}
            onTouchMove={handleMove}
            onTouchEnd={handleEnd}
            style={{
              width: '100%',
              height: 420,
              borderRadius: 12,
              border: '1px solid var(--border)',
              cursor: 'crosshair',
              touchAction: 'none',
              display: 'block',
              background: 'var(--surface-2)'
            }}
            aria-label="Shared drawing canvas"
          />

          <div className="aura-row" style={{ marginTop: 16 }}>
            <label className="aura-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Colour
              <input
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  width: 42,
                  height: 42,
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer'
                }}
              />
            </label>

            <label className="aura-muted" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              Size
              <input
                type="range"
                min="1"
                max="20"
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                style={{ width: 160 }}
              />
              <span style={{ minWidth: 24, textAlign: 'right' }}>{size}</span>
            </label>
          </div>

          <p className="aura-muted" style={{ marginTop: 16, fontSize: '0.85rem' }}>
            <Eraser size={14} style={{ verticalAlign: 'middle' }} /> The canvas clears automatically every 24 hours.{' '}
            {strokes.length} stroke{strokes.length === 1 ? '' : 's'} on the board right now.
          </p>
        </div>
      </div>
    </div>
  );
}