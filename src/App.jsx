import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Login from './pages/Login';
import Home from './pages/Home';
import MoodChat from './pages/MoodChat';
import MatchFinder from './pages/MatchFinder';
import MatchChat from './pages/MatchChat';
import DailyQuestion from './pages/DailyQuestion';
import SkillSwap from './pages/SkillSwap';
import SkillSwapCall from './pages/SkillSwapCall';
import EventBuddy from './pages/EventBuddy';
import CollabStudio from './pages/CollabStudio';
import NotificationManager from './notifications/NotificationManager';

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('aura_theme') || 'light');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('aura_theme', theme);
  }, [theme]);

  return (
    <BrowserRouter>
      <NotificationManager />
      <div style={{ minHeight: '100vh' }}>
        <Routes>
          <Route path="/" element={<Login theme={theme} setTheme={setTheme} />} />
          <Route path="/aura" element={<Home theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/chat" element={<MoodChat theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/match" element={<MatchFinder theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/match/chat" element={<MatchChat theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/question" element={<DailyQuestion theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/swap" element={<SkillSwap theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/swap/call" element={<SkillSwapCall theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/event" element={<EventBuddy theme={theme} setTheme={setTheme} />} />
          <Route path="/aura/collab" element={<CollabStudio theme={theme} setTheme={setTheme} />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}