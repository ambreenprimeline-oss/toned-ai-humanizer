/**
 * Auth context — no-account mode.
 * Every visitor is treated as an authenticated guest.
 * All data stays in localStorage; no server-side session is needed.
 */
import React, { createContext, useContext, useState } from 'react';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user] = useState({ id: 'local', email: 'guest', full_name: 'You', role: 'user' });

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: true,
        isLoadingAuth: false,
        isLoadingPublicSettings: false,
        authError: null,
        authChecked: true,
        appPublicSettings: null,
        logout: () => {},
        navigateToLogin: () => {},
        checkUserAuth: () => Promise.resolve(),
        checkAppState: () => Promise.resolve(),
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
};
