import React, { useRef, useEffect } from 'react';

/**
 * Props:
 * - strokeColor (string)
 * - strokeSize (number)
 * - onBeginStroke(pos)
 * - onPoint(pos)
 * - onEndStroke()
 */
export default function Canvas({
  strokeColor = '#000000',
  strokeSize = 4,
  onBeginStroke,
  onPoint,
  onEndStroke
}) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const lastPos = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      ctx.scale(dpr, dpr);
    };

    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const getPos = (e) => {
    const rect = canvasRef.current.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const x = (clientX - rect.left) / rect.width;
    const y = (clientY - rect.top) / rect.height;
    return { x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) };
  };

  const drawSegment = (from, to, color, size) => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.beginPath();
    ctx.moveTo(from.x * rect.width, from.y * rect.height);
    ctx.lineTo(to.x * rect.width, to.y * rect.height);
    ctx.stroke();
  };

  const handleDown = (e) => {
    e.preventDefault();
    const pos = getPos(e);
    drawing.current = true;
    lastPos.current = pos;
    if (onBeginStroke) onBeginStroke(pos);
  };

  const handleMove = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const pos = getPos(e);
    drawSegment(lastPos.current, pos, strokeColor, strokeSize);
    if (onPoint) onPoint(pos);
    lastPos.current = pos;
  };

  const handleUp = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    drawing.current = false;
    lastPos.current = null;
    if (onEndStroke) onEndStroke();
  };

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;

    el.addEventListener('mousedown', handleDown);
    el.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);

    el.addEventListener('touchstart', handleDown, { passive: false });
    el.addEventListener('touchmove', handleMove, { passive: false });
    window.addEventListener('touchend', handleUp);

    return () => {
      el.removeEventListener('mousedown', handleDown);
      el.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      el.removeEventListener('touchstart', handleDown);
      el.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleUp);
    };
  }, [strokeColor, strokeSize, onBeginStroke, onPoint, onEndStroke]);

  useEffect(() => {
    const handleRemoteStroke = (e) => {
      const stroke = e.detail;
      if (!stroke || !stroke.points) return;
      const pts = Array.isArray(stroke.points) ? stroke.points : Object.values(stroke.points || {});
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1];
        const b = pts[i];
        drawSegment(a, b, stroke.color || strokeColor, stroke.size || strokeSize);
      }
    };

    const handleClear = () => {
      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    };

    window.addEventListener('remote-stroke', handleRemoteStroke);
    window.addEventListener('clear-canvas', handleClear);
    return () => {
      window.removeEventListener('remote-stroke', handleRemoteStroke);
      window.removeEventListener('clear-canvas', handleClear);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: '100%',
        height: 400,
        borderRadius: 12,
        background: '#fff',
        boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
        touchAction: 'none'
      }}
    />
  );
}