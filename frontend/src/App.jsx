import ThemeToggle from "./components/ThemeToggle";
import ResolveBot from "./components/ResolveBot";
import SlaBadge from "./components/SlaBadge";
import { useEffect, useMemo, useRef, useState } from "react";
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
  assignTicket,
  getTicketActivities,
  getNotifications,
  markNotificationRead,
  markAllNotificationsRead,
} from "./services/api";

import "./App.css";
import { useAuth } from "./context/AuthContext";

const emptyForm = {
  title: "",
  department: "",
  priority: "Medium",
  description: "",
};

const statusOptions = ["Open", "In Progress", "Waiting for User", "Resolved"];
const priorityOptions = ["Low", "Medium", "High", "Critical"];

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

function formatDateTime(value) {
  if (!value) return "Time unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatActivityAction(action) {
  const labels = {
    TICKET_CREATED: "Ticket created",
    TICKET_ASSIGNED: "Ticket assigned",
    TICKET_REASSIGNED: "Ticket reassigned",
    STATUS_CHANGED: "Status changed",
    PRIORITY_CHANGED: "Priority changed",
    TICKET_UPDATED: "Ticket updated",
  };
  return labels[action] || (action || "Activity").replaceAll("_", " ");
}

function formatActivityValue(value) {
  if (typeof value === "object" && value !== null) {
    return Object.entries(value)
      .map(([key, item]) => `${key}: ${item ?? "—"}`)
      .join(" · ");
  }
  return String(value);
}

function getTicketDate(ticket) {
  return ticket.date || ticket.createdAt || ticket.created_at || "";
}

function App() {
  const { user, logout } = useAuth();

  const displayName = user?.name || user?.email || "User";
  const userInitials = displayName
    .split(" ")
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const displayRole = (user?.role || "USER").replaceAll("_", " ");
  const isAdmin = user?.role === "ADMIN";
  const isSupportEngineer = user?.role === "SUPPORT_ENGINEER";
  const canUpdateStatus = isAdmin || isSupportEngineer;

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
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const profileMenuRef = useRef(null);
  const notificationsRef = useRef(null);
  const sidebarProfileRef = useRef(null);
  const [updatingTicketId, setUpdatingTicketId] = useState(null);
  const [deletingTicketId, setDeletingTicketId] = useState(null);
  const [selectedTicketId, setSelectedTicketId] = useState(null);
  const [assignmentTicket, setAssignmentTicket] = useState(null);
  const [assignmentEmail, setAssignmentEmail] = useState("");
  const [assigning, setAssigning] = useState(false);
  const [activities, setActivities] = useState([]);
  const [activitiesLoading, setActivitiesLoading] = useState(false);
  const [activitiesError, setActivitiesError] = useState("");
  const [notifications, setNotifications] = useState([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationError, setNotificationError] = useState("");
  const [markingAllRead, setMarkingAllRead] = useState(false);

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

  async function loadNotifications() {
    try {
      setNotificationLoading(true);
      setNotificationError("");

      const response = await getNotifications();

      setNotifications(
        Array.isArray(response?.data) ? response.data : []
      );
      setUnreadNotificationCount(Number(response?.unreadCount) || 0);
    } catch (err) {
      setNotificationError(
        err.response?.data?.message || "Unable to load notifications."
      );
    } finally {
      setNotificationLoading(false);
    }
  }

  async function handleNotificationClick(notification) {
    try {
      if (Number(notification.isRead) === 0) {
        await markNotificationRead(notification.id);

        setNotifications((previous) =>
          previous.map((item) =>
            item.id === notification.id ? { ...item, isRead: 1 } : item
          )
        );
        setUnreadNotificationCount((previous) => Math.max(0, previous - 1));
      }

      setNotificationsOpen(false);
      openTicket(notification.ticketId);
    } catch (err) {
      setNotificationError(
        err.response?.data?.message || "Unable to update this notification."
      );
    }
  }

  async function handleMarkAllNotificationsRead() {
    if (unreadNotificationCount === 0 || markingAllRead) return;

    try {
      setMarkingAllRead(true);
      setNotificationError("");

      await markAllNotificationsRead();

      setNotifications((previous) =>
        previous.map((item) => ({ ...item, isRead: 1 }))
      );
      setUnreadNotificationCount(0);
    } catch (err) {
      setNotificationError(
        err.response?.data?.message || "Unable to mark notifications as read."
      );
    } finally {
      setMarkingAllRead(false);
    }
  }

  useEffect(() => {
    loadTickets();
  }, []);

  useEffect(() => {
    loadNotifications();

    const notificationInterval = setInterval(() => {
      loadNotifications();
    }, 30000);

    return () => clearInterval(notificationInterval);
  }, []);

  useEffect(() => {
    function handleOutsideClick(event) {
      const clickedTopbarProfile = profileMenuRef.current?.contains(event.target);
      const clickedSidebarProfile = sidebarProfileRef.current?.contains(event.target);
      if (!clickedTopbarProfile && !clickedSidebarProfile) setProfileMenuOpen(false);
      if (notificationsRef.current && !notificationsRef.current.contains(event.target)) setNotificationsOpen(false);
    }
    function handleEscape(event) {
      if (event.key === "Escape") { setProfileMenuOpen(false); setNotificationsOpen(false); }
    }
    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  async function loadTicketActivities(ticketId) {
    if (ticketId === null || ticketId === undefined) return;

    try {
      setActivitiesLoading(true);
      setActivitiesError("");

      // getTicketActivities already returns Axios response.data:
      // { success, ticketId, count, data: [...] }
      const response = await getTicketActivities(ticketId);
      const activityRecords = response?.data;

      setActivities(Array.isArray(activityRecords) ? activityRecords : []);
    } catch (err) {
      setActivitiesError(
        err.response?.data?.message || "Unable to load ticket activity history."
      );
      setActivities([]);
    } finally {
      setActivitiesLoading(false);
    }
  }

  useEffect(() => {
    if (activePage === "Ticket Details" && selectedTicketId !== null) {
      loadTicketActivities(selectedTicketId);
    } else {
      setActivities([]);
      setActivitiesError("");
    }
  }, [activePage, selectedTicketId]);

  const stats = useMemo(() => {
  const total = tickets.length;

  const open = tickets.filter(
    (ticket) => ticket.status === "Open"
  ).length;

  const progress = tickets.filter(
    (ticket) => ticket.status === "In Progress"
  ).length;

  const resolved = tickets.filter(
    (ticket) => ticket.status === "Resolved"
  ).length;

  const breached = tickets.filter(
    (ticket) => ticket.slaStatus?.overall === "BREACHED"
  ).length;

  const atRisk = tickets.filter(
    (ticket) => ticket.slaStatus?.overall === "AT_RISK"
  ).length;

  const onTrack = tickets.filter(
    (ticket) => ticket.slaStatus?.overall === "ON_TRACK"
  ).length;

  return {
    total,
    open,
    progress,
    resolved,
    breached,
    atRisk,
    onTrack,
  };
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

      await loadNotifications();
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

  async function handleTicketFieldChange(ticketId, field, value) {
    const fieldLabel = field === "status" ? "status" : "priority";

    try {
      setUpdatingTicketId(ticketId);
      setError("");
      setSuccess("");

      const response = await updateTicket(ticketId, { [field]: value });
      const updatedTicket = unwrapResponse(response);

      setTickets((previous) =>
        previous.map((ticket) =>
          String(ticket.id) === String(ticketId)
            ? { ...ticket, ...(updatedTicket || {}), [field]: value }
            : ticket
        )
      );

      await loadNotifications();
      setSuccess(`Ticket #${ticketId} ${fieldLabel} updated.`);
      if (String(selectedTicketId) === String(ticketId)) {
        await loadTicketActivities(ticketId);
      }
    } catch (err) {
      setError(
        err.response?.data?.message || `Unable to update ticket ${fieldLabel}.`
      );
    } finally {
      setUpdatingTicketId(null);
    }
  }

  async function handleStatusChange(ticketId, newStatus) {
    return handleTicketFieldChange(ticketId, "status", newStatus);
  }

  async function handlePriorityChange(ticketId, newPriority) {
    return handleTicketFieldChange(ticketId, "priority", newPriority);
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

  function openAssignment(ticket) {
    setAssignmentTicket(ticket);
    setAssignmentEmail(ticket.assignedTo || "");
    setError("");
    setSuccess("");
  }

  function closeAssignment() {
    if (assigning) return;
    setAssignmentTicket(null);
    setAssignmentEmail("");
  }

  async function handleAssignTicket(event) {
    event.preventDefault();
    if (!assignmentTicket) return;

    try {
      setAssigning(true);
      setError("");
      setSuccess("");

      const response = await assignTicket(assignmentTicket.id, assignmentEmail.trim());
      const updatedTicket = unwrapResponse(response);
      const assignedTicket = updatedTicket?.data ?? updatedTicket;

      setTickets((previous) =>
        previous.map((ticket) =>
          String(ticket.id) === String(assignmentTicket.id)
            ? { ...ticket, ...assignedTicket }
            : ticket
        )
      );

      await loadNotifications();
      setSuccess(`Ticket #${assignmentTicket.id} assigned to ${assignmentEmail.trim()}.`);
      if (String(selectedTicketId) === String(assignmentTicket.id)) {
        await loadTicketActivities(assignmentTicket.id);
      }
      setAssignmentTicket(null);
      setAssignmentEmail("");
    } catch (err) {
      setError(err.response?.data?.message || "Unable to assign this ticket.");
    } finally {
      setAssigning(false);
    }
  }

  const pageTitle =
    activePage === "Create Ticket"
      ? "Create ticket"
      : activePage === "Tickets"
        ? isAdmin ? "All tickets" : isSupportEngineer ? "Assigned tickets" : "My tickets"
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
            <span>{isAdmin ? "All tickets" : isSupportEngineer ? "Assigned tickets" : "My tickets"}</span>
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

          <div className="sidebar-profile-wrap" ref={sidebarProfileRef}>
            <div className="profile">
              <div className="profile-avatar">{userInitials}</div>
              <div className="profile-info">
                <strong>{displayName}</strong>
                <span>{displayRole}</span>
              </div>
              <button
                className="profile-menu"
                aria-label="Open account menu"
                title="Account options"
                aria-expanded={profileMenuOpen}
                onClick={() => { setProfileMenuOpen((open) => !open); setNotificationsOpen(false); }}
              >
                <ChevronDown className={profileMenuOpen ? "sidebar-chevron-open" : ""} size={17} />
              </button>
            </div>
            {profileMenuOpen && (
              <section className="sidebar-account-popover" role="menu" aria-label="Account menu">
                <div className="sidebar-account-heading">
                  <strong>{displayName}</strong>
                  <span>{user?.email || ""}</span>
                </div>
                <div className="sidebar-account-role"><ShieldCheck size={14} /> {displayRole} <i>Active</i></div>
                <button className="sidebar-account-logout" role="menuitem" onClick={() => { setProfileMenuOpen(false); logout(); }}>
                  <LogOut size={15} /> Sign out
                </button>
              </section>
            )}
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
            <ThemeToggle />
            <div className="system-status">
              <span className="status-dot" />
              System operational
            </div>
            <div className="topbar-popover-anchor" ref={notificationsRef}>
              <button
                type="button"
                className={`icon-button notification-trigger ${unreadNotificationCount > 0 ? "has-notifications" : ""}`}
                aria-label={`Notifications, ${unreadNotificationCount} unread`}
                aria-expanded={notificationsOpen}
                onClick={() => {
                  setNotificationsOpen((open) => !open);
                  setProfileMenuOpen(false);
                  if (!notificationsOpen) loadNotifications();
                }}
              >
                <Bell size={19} />
                {unreadNotificationCount > 0 && (
                  <span className="notification-count">
                    {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
                  </span>
                )}
              </button>

              {notificationsOpen && (
                <section
                  className="topbar-popover notification-popover"
                  role="dialog"
                  aria-label="Notifications"
                >
                  <div className="popover-heading">
                    <strong>Notifications</strong>
                    <span>{unreadNotificationCount} unread</span>
                  </div>

                  {unreadNotificationCount > 0 && (
                    <div className="notification-actions">
                      <button
                        type="button"
                        className="notification-mark-all"
                        onClick={handleMarkAllNotificationsRead}
                        disabled={markingAllRead}
                      >
                        {markingAllRead ? "Marking..." : "Mark all as read"}
                      </button>
                    </div>
                  )}

                  {notificationError && (
                    <div className="notification-error" role="alert">
                      {notificationError}
                    </div>
                  )}

                  {notificationLoading ? (
                    <div className="notification-loading">
                      <span className="notification-spinner" />
                      Loading notifications...
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="notification-empty">
                      <span className="notification-empty-icon">
                        <Bell size={19} />
                      </span>
                      <strong>No notifications yet</strong>
                      <p>Updates about tickets you can access will appear here.</p>
                    </div>
                  ) : (
                    <div className="notification-list">
                      {notifications.map((notification) => {
                        const isUnread = Number(notification.isRead) === 0;

                        return (
                          <button
                            type="button"
                            className={`notification-item ${isUnread ? "notification-item-unread" : ""}`}
                            key={notification.id}
                            onClick={() => handleNotificationClick(notification)}
                          >
                            <span className="notification-item-icon">
                              <Ticket size={16} />
                            </span>
                            <span className="notification-item-copy">
                              <strong>{notification.title || "Ticket update"}</strong>
                              <span>{notification.message || `Update for ticket #${notification.ticketId}`}</span>
                              <small>{formatDateTime(notification.createdAt)}</small>
                            </span>
                            {isUnread && (
                              <span className="notification-unread-dot" aria-label="Unread" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </section>
              )}
            </div>
            <div className="topbar-popover-anchor" ref={profileMenuRef}>
              <button className="topbar-account-button" aria-label="Open account menu" aria-expanded={profileMenuOpen} onClick={() => { setProfileMenuOpen((open) => !open); setNotificationsOpen(false); }}>
                <span className="topbar-avatar">{userInitials}</span>
                <span className="topbar-user"><strong>{displayName}</strong><span>{displayRole}</span></span>
                <ChevronDown className={`topbar-chevron ${profileMenuOpen ? "chevron-open" : ""}`} size={16} />
              </button>
              {profileMenuOpen && (
                <section className="topbar-popover account-popover" role="menu" aria-label="Account menu">
                  <div className="account-popover-user"><span className="topbar-avatar">{userInitials}</span><span><strong>{displayName}</strong><small>{user?.email || ""}</small></span></div>
                  <div className="account-role-line"><ShieldCheck size={15} /><span>{displayRole}</span><i>Active session</i></div>
                  <button className="account-logout" role="menuitem" onClick={() => { setProfileMenuOpen(false); logout(); }}><LogOut size={16} /> Sign out</button>
                </section>
              )}
            </div>
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
              userName={displayName}
              tickets={tickets}
              priorityData={priorityData}
              loading={loading}
              onCreate={() => navigate("Create Ticket")}
              onViewAll={() => navigate("Tickets")}
              onViewTicket={openTicket}
              onRefresh={loadTickets}
              role={user?.role}
              onFilterStatus={(status) => { setStatusFilter(status); setPriorityFilter("All"); setSearch(""); navigate("Tickets"); }}
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
              onPriorityChange={handlePriorityChange}
              onDelete={handleDeleteTicket}
              onViewTicket={openTicket}
              onAssign={openAssignment}
              updatingTicketId={updatingTicketId}
              deletingTicketId={deletingTicketId}
              canUpdateStatus={canUpdateStatus}
              isAdmin={isAdmin}
              role={user?.role}
            />
          )}

          {activePage === "Ticket Details" && (
            <TicketDetailsPage
              ticket={tickets.find(
                (ticket) => String(ticket.id) === String(selectedTicketId)
              )}
              onBack={() => navigate("Tickets")}
              onStatusChange={handleStatusChange}
              onPriorityChange={handlePriorityChange}
              onDelete={handleDeleteTicket}
              onAssign={openAssignment}
              updatingTicketId={updatingTicketId}
              deletingTicketId={deletingTicketId}
              activities={activities}
              activitiesLoading={activitiesLoading}
              activitiesError={activitiesError}
              onRefreshActivities={() => loadTicketActivities(selectedTicketId)}
              canUpdateStatus={canUpdateStatus}
              isAdmin={isAdmin}
            />
          )}

          {activePage === "Create Ticket" && (
            <CreateTicketPage
              formData={formData}
              onChange={handleInputChange}
              onSubmit={handleCreateTicket}
              onCancel={() => navigate("Dashboard")}
              submitting={submitting}
              requesterName={displayName}
            />
          )}

          {assignmentTicket && (
            <div
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeAssignment();
              }}
              style={{
                position: "fixed", inset: 0, zIndex: 1000,
                background: "rgba(15, 23, 42, 0.48)",
                display: "grid", placeItems: "center", padding: 20,
              }}
            >
              <form
                onSubmit={handleAssignTicket}
                role="dialog"
                aria-modal="true"
                aria-labelledby="assignment-modal-title"
                style={{
                  width: "min(100%, 440px)", background: "#fff",
                  borderRadius: 16, padding: 24,
                  boxShadow: "0 24px 70px rgba(15, 23, 42, 0.24)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "start" }}>
                  <div>
                    <h2 id="assignment-modal-title" style={{ margin: 0, fontSize: 20 }}>Assign support engineer</h2>
                    <p style={{ margin: "8px 0 20px", color: "#64748b", fontSize: 14 }}>
                      Ticket #{assignmentTicket.id}: {assignmentTicket.title}
                    </p>
                  </div>
                  <button type="button" onClick={closeAssignment} disabled={assigning} aria-label="Close assignment dialog" style={{ border: 0, background: "transparent", fontSize: 22, color: "#64748b" }}>×</button>
                </div>
                <label htmlFor="assignment-email" style={{ display: "block", fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
                  Support engineer email
                </label>
                <input
                  id="assignment-email"
                  type="email"
                  required
                  maxLength={120}
                  value={assignmentEmail}
                  onChange={(event) => setAssignmentEmail(event.target.value)}
                  placeholder="engineer@company.com"
                  style={{ width: "100%", padding: "11px 12px", border: "1px solid #cbd5e1", borderRadius: 8, outlineColor: "#4169e1" }}
                />
                <p style={{ margin: "8px 0 20px", fontSize: 12, color: "#64748b" }}>
                  Only an active account with the SUPPORT_ENGINEER role can be assigned.
                </p>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
                  <button type="button" className="button-secondary" onClick={closeAssignment} disabled={assigning}>Cancel</button>
                  <button type="submit" className="button-primary" disabled={assigning || !assignmentEmail.trim()}>
                    {assigning ? "Assigning..." : "Save assignment"}
                  </button>
                </div>
              </form>
            </div>
          )}

          <footer className="page-footer">
            <span>ResolveIT Service Desk</span>
            <span>IT Operations Portal · Version 1.0</span>
          </footer>
        </div>
      </main>
      <ResolveBot />
    </div>
  );
}

function DashboardPage({
  stats,
  userName,
  tickets,
  priorityData,
  loading,
  onCreate,
  onViewAll,
  onRefresh,
  onViewTicket,
  role,
  onFilterStatus,
}) {
  const isEmployee = role === "EMPLOYEE";
  const isSupportEngineer = role === "SUPPORT_ENGINEER";
  const recentTickets = [...tickets]
    .sort((a, b) => Number(b.id) - Number(a.id))
    .slice(0, 5);

  return (
    <>
      <section className="welcome-banner">
        <div className="welcome-content">
          <div className="eyebrow">{isEmployee ? "MY IT SUPPORT" : isSupportEngineer ? "SUPPORT WORKSPACE" : "IT OPERATIONS OVERVIEW"}</div>
          <h2>Good day, {userName.split(" ")[0]}.</h2>
          <p>
            {isEmployee
              ? "Create support requests and track the progress of your own IT issues."
              : isSupportEngineer
                ? "Review your assigned support requests and keep issues moving toward resolution."
                : "Monitor support requests, manage workloads, and keep your organization running smoothly."}
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
        <StatCard label="Total tickets" value={stats.total} icon={<ClipboardList size={21} />} tone="blue" note="All requests" onClick={() => onFilterStatus("All")} />
        <StatCard label="Open tickets" value={stats.open} icon={<AlertCircle size={21} />} tone="orange" note="Awaiting action" onClick={() => onFilterStatus("Open")} />
        <StatCard label="In progress" value={stats.progress} icon={<Clock3 size={21} />} tone="purple" note="Being worked on" onClick={() => onFilterStatus("In Progress")} />
        <StatCard label="Resolved" value={stats.resolved} icon={<CheckCircle2 size={21} />} tone="green" note="Completed requests" onClick={() => onFilterStatus("Resolved")} />
      </section>
      <section className="stats-grid sla-stats-grid">
  <StatCard
    label="SLA breached"
    value={stats.breached}
    icon={<AlertCircle size={21} />}
    tone="orange"
    note="Requires immediate attention"
  />

  <StatCard
    label="SLA at risk"
    value={stats.atRisk}
    icon={<Clock3 size={21} />}
    tone="purple"
    note="Approaching deadline"
  />

  <StatCard
    label="SLA on track"
    value={stats.onTrack}
    icon={<CheckCircle2 size={21} />}
    tone="green"
    note="Within SLA targets"
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
            <h3>{isEmployee ? "My recent tickets" : isSupportEngineer ? "My assigned tickets" : "Recent support tickets"}</h3>
            <p>{isEmployee ? "Your latest support requests." : isSupportEngineer ? "The latest tickets assigned to you." : "Latest requests submitted to your IT service desk."}</p>
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

function StatCard({ label, value, icon, tone, note, onClick }) {
  return (
    <button type="button" className="stat-card stat-card-button" onClick={onClick} aria-label={`View ${label.toLowerCase()}`}>
      <div className={`stat-icon ${tone}`}>{icon}</div>
      <div className="stat-card-content">
        <span className="stat-label">{label}</span>
        <strong className="stat-value">{value}</strong>
        <span className="stat-note">{note}</span>
      </div>
      <div className="stat-trend">
        <ArrowDownRight size={15} />
      </div>
    </button>
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
  onPriorityChange,
  onDelete,
  onViewTicket,
  onAssign,
  updatingTicketId,
  deletingTicketId,
  canUpdateStatus,
  isAdmin,
  role,
}) {
  const heading = role === "EMPLOYEE" ? "My support tickets" : role === "SUPPORT_ENGINEER" ? "Assigned support tickets" : "All support tickets";
  const description = role === "EMPLOYEE" ? "View and track the progress of your own support requests." : role === "SUPPORT_ENGINEER" ? "Review and update the support tickets assigned to you." : "Search, filter, assign, and manage employee support requests.";

  return (
    <section className="panel tickets-page-panel">
      <div className="panel-heading tickets-page-heading">
        <div>
          <h3>{heading}</h3>
          <p>{description}</p>
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
        onPriorityChange={onPriorityChange}
        onDelete={onDelete}
        onViewTicket={onViewTicket}
        onAssign={isAdmin ? onAssign : undefined}
        updatingTicketId={updatingTicketId}
        deletingTicketId={deletingTicketId}
        showAdminActions={isAdmin}
        canUpdateStatus={canUpdateStatus}
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
  onPriorityChange,
  onDelete,
  onViewTicket,
  onAssign,
  updatingTicketId,
  deletingTicketId,
  showAdminActions = false,
  canUpdateStatus = false,
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
    <>
      <div className="ticket-mobile-list" aria-label="Support tickets">
        {tickets.map((ticket) => (
          <article className="ticket-mobile-card" key={`mobile-${ticket.id}`}>
            <div className="ticket-mobile-card__top">
              <div>
                <span className="ticket-mobile-id">Ticket #{ticket.id}</span>
                <h4>{ticket.title || "Untitled ticket"}</h4>
                <p>{ticket.department || "General"} · {formatDate(getTicketDate(ticket))}</p>
              </div>
              <SlaBadge ticket={ticket} compact />
            </div>
            <div className="ticket-mobile-meta">
              <span className={`priority-badge ${(ticket.priority || "Medium").toLowerCase()}`}><span />{ticket.priority || "Medium"}</span>
              <StatusBadge status={ticket.status} />
            </div>
            <div className="ticket-mobile-assignee">
              <span>Assigned engineer</span>
              <strong>{ticket.assignedTo || "Unassigned"}</strong>
            </div>
            <div className="ticket-mobile-actions">
              <button type="button" className="button-secondary" onClick={() => onViewTicket?.(ticket.id)}>View details</button>
              {canUpdateStatus && onStatusChange && (
                <select
                  className="status-select"
                  value={ticket.status || "Open"}
                  disabled={updatingTicketId === ticket.id}
                  onChange={(event) => onStatusChange(ticket.id, event.target.value)}
                  aria-label={`Change status for ticket ${ticket.id}`}
                >
                  {statusOptions.map((status) => <option key={status} value={status}>{status}</option>)}
                </select>
              )}
              {showAdminActions && onAssign && (
                <button type="button" className="button-secondary" onClick={() => onAssign(ticket)}>
                  {ticket.assignedTo ? "Reassign" : "Assign"}
                </button>
              )}
              {showAdminActions && onDelete && (
                <button type="button" className="delete-button" onClick={() => onDelete(ticket.id)} disabled={deletingTicketId === ticket.id} aria-label={`Delete ticket ${ticket.id}`}>
                  <Trash2 size={16} />
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="table-scroll">
      <table className="ticket-table">
        <thead>
          <tr>
            <th>Ticket</th>
            <th>Issue details</th>
            <th>Requested by</th>
            <th>Priority</th>
            <th>Status</th>
            <th>Resolution SLA</th>
            <th>Assigned engineer</th>
            <th>Date created</th>
            {!compact && showAdminActions && <th>Actions</th>}
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
                {canUpdateStatus && onPriorityChange ? (
                  <select
                    className={`status-select priority-edit-select ${(ticket.priority || "Medium").toLowerCase()}`}
                    value={ticket.priority || "Medium"}
                    disabled={updatingTicketId === ticket.id}
                    onChange={(event) => onPriorityChange(ticket.id, event.target.value)}
                    aria-label={`Change priority for ticket ${ticket.id}`}
                  >
                    {priorityOptions.map((priority) => (
                      <option key={priority} value={priority}>{priority}</option>
                    ))}
                  </select>
                ) : (
                  <span className={`priority-badge ${(ticket.priority || "Medium").toLowerCase()}`}>
                    <span />
                    {ticket.priority || "Medium"}
                  </span>
                )}
              </td>
              <td>
                {canUpdateStatus && onStatusChange ? (
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
              <td className="ticket-sla-cell">
                <SlaBadge ticket={ticket} compact />
              </td>
              <td>
                {ticket.assignedTo ? (
                  <div className="requester-cell">
                    <span className="requester-avatar">{ticket.assignedTo.charAt(0).toUpperCase()}</span>
                    <span>{ticket.assignedTo}</span>
                  </div>
                ) : (
                  <span style={{ color: "#94a3b8", fontSize: 13 }}>Unassigned</span>
                )}
              </td>
              <td className="date-cell">{formatDate(getTicketDate(ticket))}</td>
              {!compact && showAdminActions && (
                <td>
                  <button
                    type="button"
                    className="button-secondary"
                    onClick={() => onAssign?.(ticket)}
                    style={{ marginRight: 8, padding: "7px 10px", fontSize: 12 }}
                  >
                    {ticket.assignedTo ? "Reassign" : "Assign"}
                  </button>
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
    </>
  );
}

function TicketDetailsPage({
  ticket,
  onBack,
  onStatusChange,
  onPriorityChange,
  onDelete,
  onAssign,
  updatingTicketId,
  deletingTicketId,
  activities,
  activitiesLoading,
  activitiesError,
  onRefreshActivities,
  canUpdateStatus = false,
  isAdmin = false,
}) {
  const [showAllActivities, setShowAllActivities] = useState(false);

  useEffect(() => {
    setShowAllActivities(false);
  }, [ticket?.id]);

  const visibleActivities = showAllActivities
    ? activities
    : activities.slice(0, 2);

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
              <div className="details-info-item"><span>Assigned engineer</span><strong>{ticket.assignedTo || "Unassigned"}</strong></div>
            </div>
          </section>

          <section className="panel details-section-card sla-details-card">
            <div className="details-section-heading">
              <div className="details-section-icon control-icon"><Clock3 size={18} /></div>
              <div><h3>Service level agreement</h3><p>Deadlines are shown in your device's local timezone</p></div>
            </div>
            <div className="sla-details-grid">
              <div className="sla-detail-item">
                <span>First response</span>
                <SlaBadge ticket={ticket} type="response" />
                <small>{ticket.slaResponseDueAt ? `Due ${formatDateTime(ticket.slaResponseDueAt)}` : "No response deadline"}</small>
              </div>
              <div className="sla-detail-item">
                <span>Resolution</span>
                <SlaBadge ticket={ticket} type="resolution" />
                <small>{ticket.slaResolutionDueAt ? `Due ${formatDateTime(ticket.slaResolutionDueAt)}` : "No resolution deadline"}</small>
              </div>
            </div>
            {ticket.status === "Waiting for User" && <p className="sla-pause-note">The SLA clock is paused while this ticket is waiting for the requester.</p>}
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
            <div className="activity-history-toolbar">
              <span className="activity-count">
                {activities.length} {activities.length === 1 ? "event" : "events"} recorded
              </span>
              <button
                type="button"
                className="button-secondary"
                onClick={onRefreshActivities}
                disabled={activitiesLoading}
                style={{ padding: "7px 10px", fontSize: 12 }}
              >
                <RefreshCw size={14} className={activitiesLoading ? "spin" : ""} />
                Refresh
              </button>
            </div>

            {activitiesLoading ? (
              <div className="table-message">Loading ticket activity...</div>
            ) : activitiesError ? (
              <div className="alert alert-error" role="alert" style={{ marginTop: 12 }}>
                <AlertCircle size={16} />
                <span>{activitiesError}</span>
              </div>
            ) : activities.length === 0 ? (
              <div className="activity-empty-state">
                <Clock3 size={22} />
                <strong>No activity history found</strong>
                <p>New ticket actions will appear here when they are recorded.</p>
              </div>
            ) : (
              <div className="activity-history-list">
                {visibleActivities.map((activity, index) => (
                  <article className="activity-history-item" key={activity.activityId || `${activity.action}-${index}`}>
                    <div className="activity-history-rail">
                      <span className="activity-history-dot">
                        {activity.action === "TICKET_CREATED" ? (
                          <CheckCircle2 size={15} />
                        ) : activity.action === "TICKET_ASSIGNED" || activity.action === "TICKET_REASSIGNED" ? (
                          <Users size={15} />
                        ) : activity.action === "STATUS_CHANGED" ? (
                          <Activity size={15} />
                        ) : (
                          <Clock3 size={15} />
                        )}
                      </span>
                      {index !== visibleActivities.length - 1 && <span className="activity-history-line" />}
                    </div>
                    <div className="activity-history-content">
                      <div className="activity-history-heading">
                        <strong>{formatActivityAction(activity.action)}</strong>
                        <span>{formatDateTime(activity.timestamp)}</span>
                      </div>
                      <p>{activity.description || "Ticket activity recorded."}</p>
                      {(activity.oldValue !== null && activity.oldValue !== undefined) ||
                      (activity.newValue !== null && activity.newValue !== undefined) ? (
                        <div className="activity-change-values">
                          {activity.oldValue !== null && activity.oldValue !== undefined && (
                            <span className="activity-old-value">{formatActivityValue(activity.oldValue)}</span>
                          )}
                          {activity.oldValue !== null && activity.oldValue !== undefined &&
                           activity.newValue !== null && activity.newValue !== undefined && (
                            <span aria-hidden="true">→</span>
                          )}
                          {activity.newValue !== null && activity.newValue !== undefined && (
                            <span className="activity-new-value">{formatActivityValue(activity.newValue)}</span>
                          )}
                        </div>
                      ) : null}
                      <span className="activity-performed-by">
                        Performed by: {activity.performedBy || "Unknown"}
                      </span>
                    </div>
                  </article>
                ))}
              </div>
            )}

            {!activitiesLoading && !activitiesError && activities.length > 2 && (
              <div className="activity-show-more-wrapper">
                <button
                  type="button"
                  className="activity-show-more-button"
                  onClick={() => setShowAllActivities((previous) => !previous)}
                  aria-expanded={showAllActivities}
                >
                  {showAllActivities ? "Show less" : `Show all ${activities.length} events`}
                  <ChevronDown
                    size={16}
                    className={showAllActivities ? "activity-chevron-open" : ""}
                  />
                </button>
              </div>
            )}
          </section>
        </div>

        <aside className="details-side-column">
          <section className="panel details-side-card">
            <div className="details-section-heading compact-heading">
              <div className="details-section-icon control-icon"><ShieldCheck size={18} /></div>
              <div><h3>Ticket controls</h3><p>Update request status and priority</p></div>
            </div>
            <div className="control-field">
              <label>Current status</label>
              {canUpdateStatus ? (
                <>
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
                </>
              ) : (
                <StatusBadge status={status} />
              )}
            </div>
            <div className="side-card-divider" />
            <div className="control-field">
              <label htmlFor="ticket-detail-priority">Priority level</label>
              {canUpdateStatus ? (
                <select
                  id="ticket-detail-priority"
                  className={`status-select priority-edit-select ${priority.toLowerCase()}`}
                  value={priority}
                  disabled={updatingTicketId === ticket.id}
                  onChange={(event) => onPriorityChange(ticket.id, event.target.value)}
                >
                  {priorityOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                </select>
              ) : (
                <span className={`priority-badge ${priority.toLowerCase()}`}><span />{priority}</span>
              )}
            </div>
            <div className="side-card-divider" />
            <div className="control-field">
              <label>Assigned engineer</label>
              <strong style={{ display: "block", margin: "6px 0 10px", fontSize: 13, overflowWrap: "anywhere" }}>
                {ticket.assignedTo || "Not assigned"}
              </strong>
              {isAdmin && (
                <button type="button" className="button-secondary" onClick={() => onAssign?.(ticket)}>
                  {ticket.assignedTo ? "Reassign engineer" : "Assign engineer"}
                </button>
              )}
              {ticket.assignedAt && (
                <span className="control-hint">Assigned {new Date(ticket.assignedAt).toLocaleString("en-IN")}</span>
              )}
            </div>
            {isAdmin && (
              <>
                <div className="side-card-divider" />
                <button
                  className="delete-detail-button"
                  onClick={() => onDelete(ticket.id)}
                  disabled={deletingTicketId === ticket.id}
                >
                  <Trash2 size={16} />
                  {deletingTicketId === ticket.id ? "Deleting..." : "Delete ticket"}
                </button>
              </>
            )}
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
  requesterName,
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
            <label>Requested by</label>
            <div className="requester-auto-value" style={{ padding: "11px 12px", border: "1px solid #e2e8f0", borderRadius: 9, background: "#f8fafc", color: "#334155", minHeight: 44 }}>{requesterName}</div>
            <small>Automatically taken from your signed-in account.</small>
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
