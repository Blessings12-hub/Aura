import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { doc, getDoc, collection, addDoc, onSnapshot, query, orderBy, Timestamp } from 'firebase/firestore';
import TopBar from '../components/TopBar';

export default function CollabStudio({ theme, setTheme }) {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [user, setUser] = useState(null);
  const [color, setColor] = useState('#000000');
  const [size, setSize] = useState(4);
  const [strokes, setStrokes] = useState([]);

  useEffect(() => {
    const loadUser = async () => {
      const userId = localStorage.getItem('aura_userId');
      if (!userId) return navigate('/');
      const userDoc = await getDoc(doc(db, 'users', userId));
      if (userDoc.exists()) setUser(userDoc.data());
      else navigate('/');
    };
    loadUser();
  }, [navigate]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = canvas.offsetWidth;
    canvas.height = canvas.offsetHeight;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
  }, []);

  useEffect(() => {
    const qref = query(collection(db, 'collabStudio'), orderBy('createdAt', 'asc'));
    const unsub = onSnapshot(qref, (snap) => {
      setStrokes(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    strokes.forEach((stroke) => {
      const points = stroke.points || [];
      for (let i = 1; i < points.length; i++) {
        const a = points[i - 1];
        const b = points[i];
        ctx.strokeStyle = stroke.color || '#000';
        ctx.lineWidth = stroke.size || 4;
        ctx.beginPath();
        ctx.moveTo(a.x * canvas.width, a.y * canvas.height);
        ctx.lineTo(b.x * canvas.width, b.y * canvas.height);
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
    return { x: (clientX - rect.left) / rect.width, y: (clientY - rect.top) / rect.height };
  };

  const drawLine = (from, to, strokeColor, strokeSize) => {
    const canvas = canvasRef.current;
    if (!canvas || !from || !to) return;
    const ctx = canvas.getContext('2d');
    ctx.strokeStyle = strokeColor;
    ctx.lineWidth = strokeSize;
    ctx.beginPath();
    ctx.moveTo(from.x * canvas.width, from.y * canvas.height);
    ctx.lineTo(to.x * canvas.width, to.y * canvas.height);
    ctx.stroke();
  };

  const saveStroke = async (points) => {
    const userId = localStorage.getItem('aura_userId');
    if (!userId || points.length < 2) return;

    await addDoc(collection(db, 'collabStudio'), {
      userId,
      userAge: user?.age,
      userGender: user?.gender,
      userColor: user?.avatarColor,
      color,
      size,
      points,
      createdAt: Timestamp.now()
    });
  };

  const handleStart = (e) => {
    e.preventDefault();
    const point = getPoint(e);
    if (!point) return;
    drawingRef.current = true;
    lastPointRef.current = point;
  };

  const handleMove = (e) => {
    if (!drawingRef.current || !lastPointRef.current) return;
    e.preventDefault();
    const point = getPoint(e);
    if (!point) return;
    drawLine(lastPointRef.current, point, color, size);
    lastPointRef.current = point;
  };

  const handleEnd = async () => {
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const points = lastPointRef.current ? [lastPointRef.current] : [];
    lastPointRef.current = null;
    if (points.length) await saveStroke(points);
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  if (!user) return <div className="aura-page"><div className="aura-shell"><div className="aura-card">Loading...</div></div></div>;

  return (
    <div className="aura-page">
      <div className="aura-shell">
        <TopBar
          title="Collab Studio"
          subtitle="Draw together on the same canvas. Everything resets daily."
          onBack={() => navigate(-1)}
          theme={theme}
          setTheme={setTheme}
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
              height: 400,
              borderRadius: 12,
              border: '1px solid var(--border)',
              cursor: 'crosshair',
              touchAction: 'none',
              display: 'block',
              background: 'var(--surface)'
            }}
          />

          <div className="aura-row" style={{ marginTop: 16 }}>
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              style={{ width: 50, height: 50, border: 'none', cursor: 'pointer', background: 'transparent' }}
            />
            <input
              type="range"
              min="1"
              max="20"
              value={size}
              onChange={(e) => setSize(Number(e.target.value))}
              style={{ width: 200 }}
            />
            <span className="aura-muted">Size: {size}</span>
            <button onClick={clearCanvas} className="aura-btn aura-btn-danger">
              Clear Canvas
            </button>
          </div>
        </div>

        <div className="aura-card-compact aura-section">
          <p className="aura-muted" style={{ margin: 0 }}>
            🎨 {strokes.length} strokes loaded • Draw with mouse or touch
          </p>
        </div>
      </div>
    </div>
  );
}