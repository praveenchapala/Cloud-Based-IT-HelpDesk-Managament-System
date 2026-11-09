
import {
  createContext,
  useContext,
  useMemo,
  useState,
} from "react";

import {
  loginUser,
  getAuthToken,
  getStoredUser,
  clearAuthSession,
} from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    // Restore the session when the application reloads.
    if (getAuthToken()) {
      return getStoredUser();
    }

    return null;
  });

  const [loading, setLoading] = useState(false);

  async function login(credentials) {
    setLoading(true);

    try {
      const loggedInUser = await loginUser(credentials);
      setUser(loggedInUser.user);

      return loggedInUser.user;
    } finally {
      setLoading(false);
    }
  }

  function logout() {
    clearAuthSession();
    setUser(null);
  }

  const value = useMemo(
    () => ({
      user,
      loading,
      isAuthenticated: Boolean(user && getAuthToken()),
      login,
      logout,
    }),
    [user, loading]
  );

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error(
      "useAuth must be used inside an AuthProvider"
    );
  }

  return context;
}
