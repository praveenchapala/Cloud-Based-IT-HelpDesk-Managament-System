
import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

// Get all tickets
export const getTickets = async () => {
  const response = await API.get("/tickets");
  return response.data;
};

// Get ticket by ID
export const getTicketById = async (id) => {
  const response = await API.get(`/tickets/${id}`);
  return response.data;
};

// Get activity history for a ticket
export const getTicketActivities = async (id) => {
  const response = await API.get(`/tickets/${id}/activities`);
  return response.data;
};

// Create a new ticket
export const createTicket = async (ticketData) => {
  const response = await API.post("/tickets", ticketData);
  return response.data;
};

// Update an existing ticket
export const updateTicket = async (id, updatedData) => {
  const response = await API.put(`/tickets/${id}`, updatedData);
  return response.data;
};

// Delete a ticket
export const deleteTicket = async (id) => {
  const response = await API.delete(`/tickets/${id}`);
  return response.data;
};

// Assign or reassign a ticket to a support engineer
export const assignTicket = async (id, assignedTo) => {
  const response = await API.put(`/tickets/${id}/assign`, {
    assignedTo,
  });
  return response.data;
};

// Export API instance
export default API;
