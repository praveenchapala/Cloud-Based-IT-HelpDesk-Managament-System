
import axios from "axios";

const API = axios.create({
  baseURL: "http://localhost:5000/api",
  headers: {
    "Content-Type": "application/json",
  },
});

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
  const response = await API.put(`/tickets/${id}`, updatedData);
  return response.data;
};

export const deleteTicket = async (id) => {
  const response = await API.delete(`/tickets/${id}`);
  return response.data;
};

export default API;
