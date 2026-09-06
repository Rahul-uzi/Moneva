import React, { useEffect } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { useAuthStore } from '../stores/useAuthStore';
import { LoadingState } from '../components/ui/States';

export const ProtectedRoute: React.FC = () => {
  const { isAuthenticated, isInitialized, isLoading, restoreSession } = useAuthStore();

  useEffect(() => {
    if (!isInitialized) {
      restoreSession();
    }
  }, [isInitialized, restoreSession]);

  if (!isInitialized && isLoading) {
    return (
      <div className="app-viewport">
        <LoadingState message="Restoring session..." />
      </div>
    );
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
};
