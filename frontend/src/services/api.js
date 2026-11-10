
import axios from "axios";

const TOKEN_KEY = "resolveit_token";
const USER_KEY = "resolveit_user";

// Use the production API URL from Vercel environment variables.
// Fall back to localhost for local development.
const API = axios.create({
  baseURL:
    import.meta.env.VITE_API_BASE_URL ||
    "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Attach JWT to every protected API request.
API.interceptors.request.use(
  (config) => {
    const token = sessionStorage.getItem(TOKEN_KEY);

    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }

    return config;
  },
  (error) => Promise.reject(error)
);

// Clear expired or invalid authentication sessions.
API.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem(TOKEN_KEY);
      sessionStorage.removeItem(USER_KEY);
    }

    return Promise.reject(error);
  }
);

// Authentication helpers
export const getAuthToken = () =>
  sessionStorage.getItem(TOKEN_KEY);

export const getStoredUser = () => {
  try {
    return JSON.parse(
      sessionStorage.getItem(USER_KEY) || "null"
    );
  } catch {
    return null;
  }
};

export const setAuthSession = ({ token, user }) => {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
};

export const clearAuthSession = () => {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USER_KEY);
};

// Authentication APIs
export const registerUser = async (userData) => {
  const response = await API.post("/auth/register", userData);
  return response.data;
};

export const loginUser = async (credentials) => {
  const response = await API.post("/auth/login", credentials);

  const session = response.data.data;

  setAuthSession(session);

  return session;
};

// Ticket APIs
export const getTickets = async () => {
  const response = await API.get("/tickets");
  return response.data;
};

export const getTicketById = async (id) => {
  const response = await API.get(`/tickets/${id}`);
  return response.data;
};

export const createTicket = async (ticketData) => {
  const response = await API.post("/tickets", ticketData);
  return response.data;
};

export const updateTicket = async (id, updatedData) => {
  const response = await API.put(
    `/tickets/${id}`,
    updatedData
  );

  return response.data;
};

export const assignTicket = async (id, assignedTo) => {
  const response = await API.put(
    `/tickets/${id}/assign`,
    { assignedTo }
  );

  return response.data;
};

export const deleteTicket = async (id) => {
  const response = await API.delete(`/tickets/${id}`);
  return response.data;
};

// Ticket activity API
export const getTicketActivities = async (id) => {
  const response = await API.get(
    `/tickets/${id}/activities`
  );

  return response.data;
};

// Notification APIs
export const getNotifications = async () => {
  const response = await API.get("/notifications");
  return response.data;
};

export const markNotificationRead = async (id) => {
  const response = await API.patch(
    `/notifications/${id}/read`
  );

  return response.data;
};

export const markAllNotificationsRead = async () => {
  const response = await API.patch(
    "/notifications/read-all"
  );

  return response.data;
};

export default API;
