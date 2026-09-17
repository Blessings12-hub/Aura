import { useEffect, useState } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { observeFirebaseAuth } from '../lib/firebaseClient';
import PageSkeleton from './PageSkeleton';

export default function RequireLogin({ children }) {
  const location = useLocation();
  const [user, setUser] = useState(undefined);

  useEffect(() => observeFirebaseAuth(setUser), []);

  if (user === undefined) return <PageSkeleton />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}
