import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../context/AuthContext";

export default function ProtectedRoute({ allowedRoles }) {
  const { user, isAuthenticated } = useAuth();

  // Redirect unauthenticated users to login.
  if (!isAuthenticated || !user) {
    return <Navigate to="/login" replace />;
  }

  // Restrict access based on user role.
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}