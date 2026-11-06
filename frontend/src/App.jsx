
import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDownRight,
  ArrowUpRight,
  Bell,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  Clock3,
  Headphones,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Menu,
  Plus,
  RefreshCw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  Ticket,
  Trash2,
  TrendingUp,
  Users,
  X,
} from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import {
  getTickets,
  createTicket,
  updateTicket,
  deleteTicket,
} from "./services/api";

import "./App.css";

const emptyForm = {
  title: "",
  employee: "",
  department: "",
  priority: "Medium",
  description: "",
};

const statusOptions = ["Open", "In Progress", "Resolved"];
const priorityOptions = ["Low", "Medium", "High"];

function unwrapResponse(response) {
  return response?.data ?? response;
}

function formatDate(dateValue) {
  if (!dateValue) return "—";

  const date = new Date(dateValue);

  if (Number.isNaN(date.getTime())) {
    return String(dateValue);
  }

  return date.toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getTicketDate(ticket) {
  return ticket.date || ticket.createdAt || ticket.created_at || "";
}

function App() {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const [activePage, setActivePage] = useState("Dashboard");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [priorityFilter, setPriorityFilter] = useState("All");
  const [formData, setFormData] = useState(emptyForm);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [updatingTicketId, setUpdatingTicketId] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);

  async function loadTickets() {
    try {
      setLoading(true);
      setError("");

      const response = await getTickets();
      const result = unwrapResponse(response);

      setTickets(Array.isArray(result) ? result : []);
    } catch (err) {
      setError(
        err.response?.data?.message ||
          "Unable to load tickets. Check whether the backend is running."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadTickets();
  }, []);

  const stats = useMemo(() => {
    const total = tickets.length;
    const open = tickets.filter((ticket) => ticket.status === "Open").length;
    const progress = tickets.filter(
      (ticket) => ticket.status === "In Progress"
    ).length;
    const resolved = tickets.filter(
      (ticket) => ticket.status === "Resolved"
    ).length;

    return { total, open, progress, resolved };
  }, [tickets]);

  const priorityData = useMemo(
    () =>
      priorityOptions.map((priority) => ({
        priority,
        count: tickets.filter((ticket) => ticket.priority === priority).length,
      })),
    [tickets]
  );

  const filteredTickets = useMemo(() => {
    const query = search.trim().toLowerCase();

    return tickets.filter((ticket) => {
      const searchableText = [
        ticket.id,
        ticket.title,
        ticket.employee,
        ticket.department,
        ticket.description,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();

      const matchesSearch = searchableText.includes(query);
      const matchesStatus =
        statusFilter === "All" || ticket.status === statusFilter;
      const matchesPriority =
        priorityFilter === "All" || ticket.priority === priorityFilter;

      return matchesSearch && matchesStatus && matchesPriority;
    });
  }, [tickets, search, statusFilter, priorityFilter]);

  function navigate(page) {
    setActivePage(page);
    setMobileMenuOpen(false);
    setError("");
    setSuccess("");

    if (page !== "Create Ticket") {
      setFormData(emptyForm);
    }
  }

  function openTicket(ticketId) {
    setSelectedTicketId(ticketId);
    setActivePage("Ticket Details");
    setMobileMenuOpen(false);
    setError("");
    setSuccess("");
  }

  function handleInputChange(event) {
    const { name, value } = event.target;

    setFormData((previous) => ({
      ...previous,
      [name]: value,
    }));
  }

  async function handleCreateTicket(event) {
    event.preventDefault();

    try {
      setSubmitting(true);
      setError("");
      setSuccess("");

      const response = await createTicket({
        title: formData.title.trim(),
        employee: formData.employee.trim(),
        department: formData.department,
        priority: formData.priority,
        description: formData.description.trim(),
      });

      const newTicket = unwrapResponse(response);

      if (newTicket && newTicket.id !== undefined) {
        setTickets((previous) => [newTicket, ...previous]);
      } else {
        await loadTickets();
      }

      setFormData(emptyForm);
      setActivePage("Tickets");
      setSuccess("Your support ticket has been created successfully.");
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to create the support ticket."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleStatusChange(ticketId, newStatus) {
    try {
      setUpdatingTicketId(ticketId);
      setError("");
      setSuccess("");

      const response = await updateTicket(ticketId, {
        status: newStatus,
      });

      const updatedTicket = unwrapResponse(response);

      setTickets((previous) =>
        previous.map((ticket) =>
          ticket.id === ticketId
            ? {
                ...ticket,
                ...(updatedTicket || {}),
                status: newStatus,
              }
            : ticket
        )
      );

      setSuccess(`Ticket #${ticketId} status updated.`);
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to update ticket status."
      );
    } finally {
      setUpdatingTicketId(null);
    }
  }

  async function handleDeleteTicket(ticketId) {
    const confirmed = window.confirm(
      `Are you sure you want to delete ticket #${ticketId}? This action cannot be undone.`
    );

    if (!confirmed) return;

    try {
      setDeletingTicketId(ticketId);
      setError("");
      setSuccess("");

      await deleteTicket(ticketId);

      setTickets((previous) =>
        previous.filter((ticket) => ticket.id !== ticketId)
      );

      if (String(selectedTicketId) === String(ticketId)) {
        setSelectedTicketId(null);
        setActivePage("Tickets");
      }

      setSuccess(`Ticket #${ticketId} has been deleted.`);
    } catch (err) {
      setError(
        err.response?.data?.message || "Unable to delete this ticket."
      );
    } finally {
      setDeletingTicketId(null);
    }
  }

  const pageTitle =
    activePage === "Create Ticket"
      ? "Create ticket"
      : activePage === "Tickets"
        ? "All tickets"
        : activePage === "Ticket Details"
          ? "Ticket details"
          : "Dashboard";

  return (
    <div className="app-shell">
      {mobileMenuOpen && (
        <button
          className="mobile-overlay"
          aria-label="Close navigation"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      <aside className={`sidebar ${mobileMenuOpen ? "sidebar-open" : ""}`}>
        <div className="brand">
          <div className="brand-mark">
            <Headphones size={23} strokeWidth={2.4} />
          </div>
          <div className="brand-copy">
            <strong>ResolveIT</strong>
            <span>IT SERVICE DESK</span>
          </div>
          <button
            className="mobile-close"
            onClick={() => setMobileMenuOpen(false)}
            aria-label="Close menu"
          >
            <X size={19} />
          </button>
        </div>

        <div className="workspace-label">WORKSPACE</div>

        <nav className="sidebar-nav">
          <button
            className={`nav-link ${activePage === "Dashboard" ? "active" : ""}`}
            onClick={() => navigate("Dashboard")}
          >
            <LayoutDashboard size={19} />
            <span>Dashboard</span>
          </button>

          <button
            className={`nav-link ${activePage === "Tickets" ? "active" : ""}`}
            onClick={() => navigate("Tickets")}
          >
            <Ticket size={19} />
            <span>All tickets</span>
            <span className="nav-count">{tickets.length}</span>
          </button>

          <button
            className={`nav-link ${
              activePage === "Create Ticket" ? "active" : ""
            }`}
            onClick={() => navigate("Create Ticket")}
          >
            <Plus size={19} />
            <span>Create ticket</span>
          </button>
        </nav>

        <div className="workspace-label tools-label">MANAGEMENT</div>

        <nav className="sidebar-nav">
          <button className="nav-link" onClick={() => navigate("Tickets")}>
            <Users size={19} />
            <span>Employees</span>
          </button>
          <button className="nav-link" onClick={() => navigate("Tickets")}>
            <ShieldCheck size={19} />
            <span>Service operations</span>
          </button>
          <button className="nav-link" onClick={() => navigate("Dashboard")}>
            <Activity size={19} />
            <span>Activity overview</span>
          </button>
        </nav>

        <div className="sidebar-bottom">
          <div className="help-card">
            <div className="help-icon">
              <LifeBuoy size={20} />
            </div>
            <strong>Need assistance?</strong>
            <p>Manage and resolve employee IT issues from one place.</p>
            <button onClick={() => navigate("Create Ticket")}>
              Create a ticket <span>→</span>
            </button>
          </div>

          <div className="profile">
            <div className="profile-avatar">AD</div>
            <div className="profile-info">
              <strong>Admin User</strong>
              <span>IT Administrator</span>
            </div>
            <button
              className="profile-menu"
              aria-label="Profile options"
              title="Profile options"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu-button"
              onClick={() => setMobileMenuOpen(true)}
              aria-label="Open navigation"
            >
              <Menu size={21} />
            </button>
            <div>
              <div className="breadcrumb">Workspace / {pageTitle}</div>
              <h1>{pageTitle}</h1>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="system-status">
              <span className="status-dot" />
              System operational
            </div>
            <button className="icon-button" aria-label="Notifications">
              <Bell size={19} />
              <span className="notification-dot" />
            </button>
            <div className="topbar-avatar">AD</div>
            <div className="topbar-user">
              <strong>Admin User</strong>
              <span>Administrator</span>
            </div>
            <ChevronDown className="topbar-chevron" size={16} />
          </div>
        </header>

        <div className="page-content">
          {error && (
            <div className="alert alert-error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={17} />
              </button>
            </div>
          )}

          {success && (
            <div className="alert alert-success" role="status">
              <CheckCircle2 size={18} />
              <span>{success}</span>
              <button
                onClick={() => setSuccess("")}
                aria-label="Dismiss message"
              >
                <X size={17} />
              </button>
            </div>
          )}

          {activePage === "Dashboard" && (
            <DashboardPage
              stats={stats}
              tickets={tickets}
              priorityData={priorityData}
              loading={loading}
              onCreate={() => navigate("Create Ticket")}
              onViewAll={() => navigate("Tickets")}
              onViewTicket={openTicket}
              onRefresh={loadTickets}
            />
          )}

          {activePage === "Tickets" && (
            <TicketsPage
              tickets={filteredTickets}
              totalTickets={tickets.length}
              loading={loading}
              search={search}
              setSearch={setSearch}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
              priorityFilter={priorityFilter}
              setPriorityFilter={setPriorityFilter}
              onRefresh={loadTickets}
              onCreate={() => navigate("Create Ticket")}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteTicket}
              onViewTicket={openTicket}
              updatingTicketId={updatingTicketId}
              deletingTicketId={deletingTicketId}
            />
          )}

          {activePage === "Ticket Details" && (
            <TicketDetailsPage
              ticket={tickets.find(
                (ticket) => String(ticket.id) === String(selectedTicketId)
              )}
              onBack={() => navigate("Tickets")}
              onStatusChange={handleStatusChange}
              onDelete={handleDeleteTicket}
              updatingTicketId={updatingTicketId}
              deletingTicketId={deletingTicketId}
            />
          )}

          {activePage === "Create Ticket" && (
            <CreateTicketPage
              formData={formData}
              onChange={handleInputChange}
              onSubmit={handleCreateTicket}
              onCancel={() => navigate("Dashboard")}
              submitting={submitting}
            />
          )}

          <footer className="page-footer">
            <span>ResolveIT Service Desk</span>
            <span>IT Operations Portal · Version 1.0</span>
          </footer>
        </div>
      </main>
    </div>
  );
}

function DashboardPage({
  stats,
  tickets,
  priorityData,
  loading,
  onCreate,
  onViewAll,
  onRefresh,
  onViewTicket,
}) {
  const recentTickets = [...tickets]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 5);

  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-content">
          <div className="eyebrow">IT OPERATIONS OVERVIEW</div>
          <h2>Good day, Admin.</h2>
          <p>
            Monitor your support requests, track progress, and keep your
            workplace running smoothly.
          </p>
          <button className="button-primary welcome-button" onClick={onCreate}>
            <Plus size={17} /> Create new ticket
          </button>
        </div>
        <div className="welcome-decoration">
          <div className="decoration-circle circle-one" />
          <div className="decoration-circle circle-two" />
          <div className="welcome-illustration">
            <Headphones size={76} strokeWidth={1.3} />
            <span className="illustration-check">
              <CheckCircle2 size={24} />
            </span>
          </div>
        </div>
      </section>

      <div className="section-heading">
        <div>
          <h2>Support overview</h2>
          <p>Current ticket status across your organization.</p>
        </div>
        <button
          className="button-secondary refresh-button"
          onClick={onRefresh}
          disabled={loading}
        >
          <RefreshCw size={16} className={loading ? "spin" : ""} />
          Refresh data
        </button>
      </div>

      <section className="stats-grid">
        <StatCard
          label="Total tickets"
          value={stats.total}
          icon={<ClipboardList size={21} />}
          tone="blue"
          note="All requests"
        />
        <StatCard
          label="Open tickets"
          value={stats.open}
          icon={<AlertCircle size={21} />}
          tone="orange"
          note="Awaiting action"
        />
        <StatCard
          label="In progress"
          value={stats.progress}
          icon={<Clock3 size={21} />}
          tone="purple"
          note="Being worked on"
        />
        <StatCard
          label="Resolved"
          value={stats.resolved}
          icon={<CheckCircle2 size={21} />}
          tone="green"
          note="Completed requests"
        />
      </section>

      <section className="dashboard-grid">
        <div className="panel chart-panel">
          <div className="panel-heading">
            <div>
              <h3>Tickets by priority</h3>
              <p>Distribution of current support requests</p>
            </div>
            <span className="panel-icon">
              <TrendingUp size={18} />
            </span>
          </div>

          {loading ? (
            <div className="chart-placeholder">Loading chart...</div>
          ) : (
            <div className="chart-container">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={priorityData}
                  margin={{ top: 12, right: 12, left: -20, bottom: 0 }}
                >
                  <CartesianGrid
                    stroke="#edf0f5"
                    strokeDasharray="4 4"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="priority"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#778197", fontSize: 12 }}
                  />
                  <YAxis
                    allowDecimals={false}
                    axisLine={false}
                    tickLine={false}
                    tick={{ fill: "#778197", fontSize: 12 }}
                  />
                  <Tooltip
                    cursor={{ fill: "#f5f7fb" }}
                    contentStyle={{
                      border: "1px solid #e8ebf1",
                      borderRadius: 10,
                      boxShadow: "0 8px 24px rgba(20,30,60,.08)",
                    }}
                  />
                  <Bar
                    dataKey="count"
                    name="Tickets"
                    fill="#4169e1"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={48}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}

          <div className="chart-legend">
            <span><i className="legend-dot high" /> High priority</span>
            <span><i className="legend-dot medium" /> Medium priority</span>
            <span><i className="legend-dot low" /> Low priority</span>
          </div>
        </div>

        <div className="panel status-panel">
          <div className="panel-heading">
            <div>
              <h3>Ticket status</h3>
              <p>Current workload summary</p>
            </div>
            <span className="panel-icon">
              <Activity size={18} />
            </span>
          </div>

          <div className="status-summary">
            <div className="status-summary-row">
              <div className="status-summary-label">
                <span className="status-indicator open-indicator" />
                <span>Open</span>
              </div>
              <strong>{stats.open}</strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill open-fill"
                style={{
                  width: `${stats.total ? (stats.open / stats.total) * 100 : 0}%`,
                }}
              />
            </div>

            <div className="status-summary-row">
              <div className="status-summary-label">
                <span className="status-indicator progress-indicator" />
                <span>In progress</span>
              </div>
              <strong>{stats.progress}</strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill progress-fill-purple"
                style={{
                  width: `${
                    stats.total ? (stats.progress / stats.total) * 100 : 0
                  }%`,
                }}
              />
            </div>

            <div className="status-summary-row">
              <div className="status-summary-label">
                <span className="status-indicator resolved-indicator" />
                <span>Resolved</span>
              </div>
              <strong>{stats.resolved}</strong>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill resolved-fill"
                style={{
                  width: `${
                    stats.total ? (stats.resolved / stats.total) * 100 : 0
                  }%`,
                }}
              />
            </div>
          </div>

          <div className="status-panel-footer">
            <span>Total tracked requests</span>
            <strong>{stats.total}</strong>
          </div>
        </div>
      </section>

      <section className="panel recent-panel">
        <div className="panel-heading recent-heading">
          <div>
            <h3>Recent support tickets</h3>
            <p>Latest requests submitted to your IT service desk.</p>
          </div>
          <button className="text-button" onClick={onViewAll}>
            View all tickets <ArrowUpRight size={16} />
          </button>
        </div>

        <TicketTable
          tickets={recentTickets}
          loading={loading}
          compact
          onViewTicket={onViewTicket}
        />
      </section>
    </>
  );
}

function StatCard({ label, value, icon, tone, note }) {
  return (
    <article className="stat-card">
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-card-content">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        <span className="stat-note">{note}</span>
      </div>
      <div className="stat-trend">
        <ArrowDownRight size={15} />
      </div>
    </article>
  );
}

function TicketsPage({
  tickets,
  totalTickets,
  loading,
  search,
  setSearch,
  statusFilter,
  setStatusFilter,
  priorityFilter,
  setPriorityFilter,
  onRefresh,
  onCreate,
  onStatusChange,
  onDelete,
  onViewTicket,
  updatingTicketId,
  deletingTicketId,
}) {
  return (
    <section className="panel tickets-page-panel">
      <div className="panel-heading tickets-page-heading">
        <div>
          <h3>All support tickets</h3>
          <p>Search, filter, and manage employee support requests.</p>
        </div>
        <button className="button-primary" onClick={onCreate}>
          <Plus size={17} /> New ticket
        </button>
      </div>

      <div className="filter-toolbar">
        <div className="search-box">
          <Search size={18} />
          <input
            type="search"
            placeholder="Search by ID, issue, employee..."
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          {search && (
            <button
              onClick={() => setSearch("")}
              aria-label="Clear search"
              className="clear-search"
            >
              <X size={16} />
            </button>
          )}
        </div>

        <select
          className="filter-select"
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value)}
          aria-label="Filter by status"
        >
          <option value="All">All statuses</option>
          {statusOptions.map((status) => (
            <option key={status} value={status}>{status}</option>
          ))}
        </select>

        <select
          className="filter-select"
          value={priorityFilter}
          onChange={(event) => setPriorityFilter(event.target.value)}
          aria-label="Filter by priority"
        >
          <option value="All">All priorities</option>
          {priorityOptions.map((priority) => (
            <option key={priority} value={priority}>{priority}</option>
          ))}
        </select>

        <button
          className="button-secondary filter-refresh"
          onClick={onRefresh}
          disabled={loading}
          aria-label="Refresh tickets"
          title="Refresh tickets"
        >
          <RefreshCw size={17} />
        </button>
      </div>

      <TicketTable
        tickets={tickets}
        loading={loading}
        onStatusChange={onStatusChange}
        onDelete={onDelete}
        onViewTicket={onViewTicket}
        updatingTicketId={updatingTicketId}
        deletingTicketId={deletingTicketId}
      />

      <div className="table-bottom">
        <span>
          Showing <strong>{tickets.length}</strong> of{" "}
          <strong>{totalTickets}</strong> tickets
        </span>
        <span>Live data from your helpdesk database</span>
      </div>
    </section>
  );
}

function TicketTable({
  tickets,
  loading,
  compact = false,
  onStatusChange,
  onDelete,
  onViewTicket,
  updatingTicketId,
  deletingTicketId,
}) {
  if (loading) {
    return <div className="table-message">Loading support tickets...</div>;
  }

  if (!tickets.length) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon"><Ticket size={25} /></div>
        <h3>No tickets found</h3>
        <p>
          There are no matching support requests to display right now.
        </p>
      </div>
    );
  }

  return (
    <div className="table-scroll">
      <table className="ticket-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Issue details</th>
            <th>Requested by</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Date created</th>
            {!compact && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {tickets.map((ticket) => (
            <tr key={ticket.id}>
              <td>
                <button
                  type="button"
                  className="ticket-number ticket-link"
                  onClick={() => onViewTicket?.(ticket.id)}
                  title={`View ticket ${ticket.id}`}
                >
                  #{ticket.id}
                </button>
              </td>
              <td>
                <div className="issue-cell">
                  <strong>{ticket.title || "Untitled ticket"}</strong>
                  <span>{ticket.department || "General"}</span>
                </div>
              </td>
              <td>
                <div className="requester-cell">
                  <span className="requester-avatar">
                    {(ticket.employee || "U").charAt(0).toUpperCase()}
                  </span>
                  <span>{ticket.employee || "Unknown"}</span>
                </div>
              </td>
              <td>
                <span
                  className={`priority-badge ${(ticket.priority || "Medium").toLowerCase()}`}
                >
                  <span />
                  {ticket.priority || "Medium"}
                </span>
              </td>
              <td>
                {onStatusChange ? (
                  <select
                    className={`status-select ${(ticket.status || "Open")
                      .toLowerCase()
                      .replace(" ", "-")}`}
                    value={ticket.status || "Open"}
                    disabled={updatingTicketId === ticket.id}
                    onChange={(event) =>
                      onStatusChange(ticket.id, event.target.value)
                    }
                    aria-label={`Change status for ticket ${ticket.id}`}
                  >
                    {statusOptions.map((status) => (
                      <option key={status} value={status}>{status}</option>
                    ))}
                  </select>
                ) : (
                  <StatusBadge status={ticket.status} />
                )}
              </td>
              <td className="date-cell">{formatDate(getTicketDate(ticket))}</td>
              {!compact && (
                <td>
                  <button
                    className="delete-button"
                    onClick={() => onDelete(ticket.id)}
                    disabled={deletingTicketId === ticket.id}
                    aria-label={`Delete ticket ${ticket.id}`}
                    title="Delete ticket"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TicketDetailsPage({
  ticket,
  onBack,
  onStatusChange,
  onDelete,
  updatingTicketId,
  deletingTicketId,
}) {
  if (!ticket) {
    return (
      <section className="panel ticket-details-panel ticket-not-found">
        <div className="details-empty-icon"><Ticket size={26} /></div>
        <h2>Ticket not found</h2>
        <p>This ticket may have been deleted or is no longer available.</p>
        <button className="button-primary" onClick={onBack}>Back to tickets</button>
      </section>
    );
  }

  const status = ticket.status || "Open";
  const priority = ticket.priority || "Medium";
  const createdDate = formatDate(getTicketDate(ticket));
  const requesterInitial = (ticket.employee || "U").charAt(0).toUpperCase();

  return (
    <section className="ticket-details-layout">
      <div className="details-toolbar">
        <button className="button-secondary details-back-button" onClick={onBack}>
          <span aria-hidden="true">←</span> Back to tickets
        </button>
        <div className="details-breadcrumb-meta">
          <span>Support tickets</span><span>/</span><strong>#{ticket.id}</strong>
        </div>
      </div>

      <div className="details-hero">
        <div className="details-hero-main">
          <div className="details-ticket-icon"><Ticket size={23} /></div>
          <div className="details-hero-copy">
            <div className="details-eyebrow">IT SERVICE REQUEST <span>•</span> TICKET #{ticket.id}</div>
            <h2>{ticket.title || "Untitled ticket"}</h2>
            <p>Created {createdDate} <span className="details-meta-dot">·</span> Submitted by {ticket.employee || "Unknown requester"}</p>
          </div>
        </div>
        <div className="details-hero-badges">
          <StatusBadge status={status} />
          <span className={`priority-badge ${priority.toLowerCase()}`}><span />{priority} priority</span>
        </div>
      </div>

      <div className="details-content-grid">
        <div className="details-main-column">
          <section className="panel details-section-card">
            <div className="details-section-heading">
              <div className="details-section-icon"><ClipboardList size={18} /></div>
              <div><h3>Request overview</h3><p>Key information associated with this support request</p></div>
            </div>
            <div className="details-info-grid">
              <div className="details-info-item"><span>Ticket reference</span><strong>#{ticket.id}</strong></div>
              <div className="details-info-item"><span>Requested by</span><strong>{ticket.employee || "Unknown"}</strong></div>
              <div className="details-info-item"><span>Department</span><strong>{ticket.department || "General"}</strong></div>
              <div className="details-info-item"><span>Date submitted</span><strong>{createdDate}</strong></div>
            </div>
          </section>

          <section className="panel details-section-card description-card">
            <div className="details-section-heading">
              <div className="details-section-icon description-icon"><Activity size={18} /></div>
              <div><h3>Issue description</h3><p>Details provided by the requester</p></div>
            </div>
            <div className="description-content">{ticket.description || "No description was provided for this request."}</div>
          </section>

          <section className="panel details-section-card activity-card">
            <div className="details-section-heading">
              <div className="details-section-icon activity-icon"><Clock3 size={18} /></div>
              <div><h3>Ticket activity</h3><p>Recorded information available for this ticket</p></div>
            </div>
            <div className="activity-entry">
              <div className="activity-timeline-marker"><CheckCircle2 size={15} /></div>
              <div className="activity-entry-copy">
                <strong>Ticket created</strong>
                <p>{ticket.employee || "The requester"} submitted this support request.</p>
                <span>{createdDate}</span>
              </div>
              <span className="activity-entry-tag">Created</span>
            </div>
            <p className="activity-note">Additional activity history will appear here as ticket updates are recorded.</p>
          </section>
        </div>

        <aside className="details-side-column">
          <section className="panel details-side-card">
            <div className="details-section-heading compact-heading">
              <div className="details-section-icon control-icon"><ShieldCheck size={18} /></div>
              <div><h3>Ticket controls</h3><p>Manage request status</p></div>
            </div>
            <div className="control-field">
              <label htmlFor="ticket-detail-status">Current status</label>
              <select
                id="ticket-detail-status"
                className={`status-select ${(status).toLowerCase().replace(" ", "-")}`}
                value={status}
                disabled={updatingTicketId === ticket.id}
                onChange={(event) => onStatusChange(ticket.id, event.target.value)}
              >
                {statusOptions.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
              {updatingTicketId === ticket.id && <span className="control-hint">Saving status...</span>}
            </div>
            <div className="side-card-divider" />
            <div className="control-field">
              <label>Priority level</label>
              <span className={`priority-badge ${priority.toLowerCase()}`}><span />{priority}</span>
            </div>
            <div className="side-card-divider" />
            <button
              className="delete-detail-button"
              onClick={() => onDelete(ticket.id)}
              disabled={deletingTicketId === ticket.id}
            >
              <Trash2 size={16} />
              {deletingTicketId === ticket.id ? "Deleting..." : "Delete ticket"}
            </button>
          </section>

          <section className="panel details-side-card requester-card">
            <div className="details-section-heading compact-heading">
              <div className="details-section-icon requester-icon"><Users size={18} /></div>
              <div><h3>Requester</h3><p>Employee information</p></div>
            </div>
            <div className="requester-profile">
              <div className="requester-large-avatar">{requesterInitial}</div>
              <div><strong>{ticket.employee || "Unknown requester"}</strong><span>{ticket.department || "General department"}</span></div>
            </div>
            <div className="requester-detail-row"><span>Department</span><strong>{ticket.department || "General"}</strong></div>
            <div className="requester-detail-row"><span>Ticket reference</span><strong>#{ticket.id}</strong></div>
          </section>
        </aside>
      </div>
    </section>
  );
}

function StatusBadge({ status }) {
  const normalizedStatus = status || "Open";

  return (
    <span
      className={`status-badge ${normalizedStatus
        .toLowerCase()
        .replace(" ", "-")}`}
    >
      <span />
      {normalizedStatus}
    </span>
  );
}

function CreateTicketPage({
  formData,
  onChange,
  onSubmit,
  onCancel,
  submitting,
}) {
  return (
    <section className="create-layout">
      <div className="create-intro">
        <div className="create-intro-icon">
          <Ticket size={24} />
        </div>
        <div>
          <h2>Submit a support request</h2>
          <p>
            Provide clear information about the issue so the IT team can
            investigate and resolve it.
          </p>
        </div>
      </div>

      <form className="panel create-form" onSubmit={onSubmit}>
        <div className="form-section-heading">
          <div>
            <h3>Ticket information</h3>
            <p>Fields marked with * are required.</p>
          </div>
          <span className="required-label">* Required fields</span>
        </div>

        <div className="form-grid">
          <div className="form-field full-field">
            <label htmlFor="title">Issue title <span>*</span></label>
            <input
              id="title"
              name="title"
              value={formData.title}
              onChange={onChange}
              placeholder="Example: Unable to connect to company Wi-Fi"
              maxLength={100}
              required
            />
            <small>Summarize the issue in a short sentence.</small>
          </div>

          <div className="form-field">
            <label htmlFor="employee">Employee name <span>*</span></label>
            <input
              id="employee"
              name="employee"
              value={formData.employee}
              onChange={onChange}
              placeholder="Enter employee name"
              maxLength={80}
              required
            />
          </div>

          <div className="form-field">
            <label htmlFor="department">Department <span>*</span></label>
            <select
              id="department"
              name="department"
              value={formData.department}
              onChange={onChange}
              required
            >
              <option value="">Select department</option>
              <option value="HR">Human Resources</option>
              <option value="Finance">Finance</option>
              <option value="Development">Development</option>
              <option value="Marketing">Marketing</option>
              <option value="Operations">Operations</option>
              <option value="IT">IT</option>
            </select>
          </div>

          <div className="form-field">
            <label htmlFor="priority">Priority level</label>
            <select
              id="priority"
              name="priority"
              value={formData.priority}
              onChange={onChange}
            >
              <option value="Low">Low</option>
              <option value="Medium">Medium</option>
              <option value="High">High</option>
            </select>
            <small>Choose based on the business impact.</small>
          </div>

          <div className="form-field full-field">
            <label htmlFor="description">
              Issue description <span>*</span>
            </label>
            <textarea
              id="description"
              name="description"
              value={formData.description}
              onChange={onChange}
              placeholder="Describe what happened, when it started, and any error messages you see..."
              rows={6}
              maxLength={1000}
              required
            />
            <div className="textarea-footer">
              <small>Include useful details to help troubleshooting.</small>
              <small>{formData.description.length}/1000</small>
            </div>
          </div>
        </div>

        <div className="form-footer">
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="submit"
            className="button-primary"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <RefreshCw size={16} className="spin" />
                Submitting...
              </>
            ) : (
              <>
                <Send size={16} />
                Submit ticket
              </>
            )}
          </button>
        </div>
      </form>

      <div className="form-note">
        <ShieldCheck size={18} />
        <span>
          Your request will be stored in the helpdesk system and made available
          to the IT support team.
        </span>
      </div>
    </section>
  );
}

export default App;
