# ResolveIT – Cloud-Based IT Help Desk Management System

<p align="center">
  <img src="https://readme-typing-svg.demolab.com?font=Fira+Code&weight=600&size=25&pause=1000&color=4F7DF3&center=true&vCenter=true&width=700&lines=Welcome+to+ResolveIT;Smart+IT+Service+Desk+Platform;Manage+Tickets.+Track+Issues.+Resolve+Faster." alt="Typing SVG" />
</p>

<p align="center">
  A centralized, cloud-based IT service desk platform designed to streamline support requests, manage incidents, track ticket activities, and improve IT service operations.
</p>

<p align="center">
  <a href="https://resolveit-cloud-platform.vercel.app">
    <img src="https://img.shields.io/badge/Live%20Demo-Visit%20ResolveIT-4F7DF3?style=for-the-badge&logo=vercel&logoColor=white" alt="Live Demo" />
  </a>
  <a href="https://github.com/praveenchapala/Cloud-Based-IT-HelpDesk-Managament-System">
    <img src="https://img.shields.io/badge/GitHub-Source%20Code-181717?style=for-the-badge&logo=github" alt="GitHub Repository" />
  </a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Frontend-React-61DAFB?style=flat&logo=react&logoColor=black" />
  <img src="https://img.shields.io/badge/Backend-Node.js-339933?style=flat&logo=nodedotjs&logoColor=white" />
  <img src="https://img.shields.io/badge/API-Express-000000?style=flat&logo=express&logoColor=white" />
  <img src="https://img.shields.io/badge/Database-SQLite-003B57?style=flat&logo=sqlite&logoColor=white" />
  <img src="https://img.shields.io/badge/AWS-DynamoDB-4053D6?style=flat&logo=amazondynamodb&logoColor=white" />
  <img src="https://img.shields.io/badge/Deployment-Vercel-000000?style=flat&logo=vercel" />
  <img src="https://img.shields.io/badge/Deployment-Render-46E3B7?style=flat&logo=render&logoColor=black" />
</p>

---

## Overview

**ResolveIT** is a cloud-based IT Help Desk Management System that provides a centralized platform for managing IT support operations.

Traditional IT support processes often involve scattered emails, manual issue tracking, delayed responses, and a lack of visibility into support activities.

ResolveIT addresses these challenges by providing a structured ticket management environment where users can submit support requests, track ticket progress, and manage service desk activities.

The platform is built using a modern full-stack architecture with cloud deployment and database integration.

## Key Features

### Authentication & User Management
- User registration and login.
- JWT-based authentication.
- Protected application routes.
- Session management.

### IT Ticket Management
- Create and submit support tickets.
- View and manage tickets.
- Update ticket information.
- Assign tickets to support personnel.
- Track ticket activities and changes.

### Notification Management
- Generate notifications for relevant ticket activities.
- Store notification records.
- Track user-related notifications.

### Cloud Deployment
- Frontend hosted on Vercel.
- Backend hosted on Render.
- AWS DynamoDB integration for ticket storage.
- SQLite database for user and notification data.
- Environment-based configuration.

## Technology Stack

| Category | Technologies |
|---|---|
| Frontend | React.js, JavaScript, HTML, CSS |
| Routing | React Router |
| API Integration | Axios, REST APIs |
| Backend | Node.js, Express.js |
| Authentication | JSON Web Tokens (JWT) |
| Database | SQLite |
| Cloud Database | AWS DynamoDB |
| Frontend Hosting | Vercel |
| Backend Hosting | Render |
| Version Control | Git, GitHub |

## System Architecture

```text
                 USER
                   |
                   v
          React.js Frontend
             (Vercel)
                   |
                   v
             Axios / REST
                   |
                   v
          Node.js + Express
              (Render)
                   |
          +--------+--------+
          |                 |
          v                 v
      SQLite            AWS DynamoDB
          |                 |
          v                 v
    Users &             IT Tickets
   Notifications
```

## Live Application

| Component | URL |
|---|---|
| Live Frontend | https://resolveit-cloud-platform.vercel.app |
| Backend API | https://resolveit-backend-knqh.onrender.com/api |
| GitHub Repository | https://github.com/praveenchapala/Cloud-Based-IT-HelpDesk-Managament-System |

## Project Structure

```text
Cloud-Based-IT-HelpDesk-Managament-System/
│
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── api/
│   │   └── ...
│   ├── package.json
│   └── vite.config.js
│
├── backend/
│   ├── src/
│   │   ├── routes/
│   │   ├── middleware/
│   │   ├── ...
│   │   └── server.js
│   ├── package.json
│   └── ...
│
└── README.md
```

*The structure above illustrates the main application organization; actual subdirectories may differ.*

## Getting Started

Follow these steps to run ResolveIT locally.

### Prerequisites

Make sure you have installed:

- Node.js and npm
- Git
- AWS account with the required DynamoDB permissions and table configuration

### 1. Clone the Repository

```bash
git clone https://github.com/praveenchapala/Cloud-Based-IT-HelpDesk-Managament-System.git
```

```bash
cd Cloud-Based-IT-HelpDesk-Managament-System
```

### 2. Configure the Backend

```bash
cd backend
npm install
```

Create a `.env` file inside the backend directory.

```env
PORT=5000
NODE_ENV=development
JWT_SECRET=your_secure_jwt_secret
RESOLVEIT_DB_PATH=./data/resolveit.db

AWS_REGION=your_aws_region
DYNAMODB_TABLE=your_dynamodb_table
```

Configure your AWS credentials securely using an appropriate AWS credentials provider or IAM role.

### 3. Start the Backend

Use the development script defined in your backend `package.json`.

```bash
npm run dev
```

### 4. Configure the Frontend

Open another terminal:

```bash
cd frontend
npm install
```

Create a `.env` file:

```env
VITE_API_BASE_URL=http://localhost:5000/api
```

### 5. Start the Frontend

```bash
npm run dev
```

Open the local URL provided by Vite, typically:

```text
http://localhost:5173
```

## Environment Variables

| Variable | Description |
|---|---|
| PORT | Backend server port |
| NODE_ENV | Application environment |
| JWT_SECRET | Secret used for JWT signing |
| RESOLVEIT_DB_PATH | SQLite database location |
| AWS_REGION | AWS deployment region |
| DYNAMODB_TABLE | DynamoDB table name |
| VITE_API_BASE_URL | Backend API base URL for frontend |

**Security:** Never commit `.env` files, JWT secrets, AWS access keys, or database credentials to GitHub.

## Deployment

ResolveIT uses separate deployment environments for its frontend and backend.

**Frontend – Vercel**
1. Connect the GitHub repository to Vercel.
2. Set the frontend root directory to `frontend`.
3. Configure the production `VITE_API_BASE_URL`.
4. Set the build command to `npm run build`.
5. Set the output directory to `dist`.
6. Deploy the application.

**Backend – Render**
1. Connect the GitHub repository to Render.
2. Set the backend root directory to `backend`.
3. Configure production environment variables.
4. Configure the SQLite persistent disk if using SQLite in production.
5. Configure AWS permissions and DynamoDB settings.
6. Deploy the backend service.

## Future Enhancements

- Email notifications and automated alerts.
- Role-based access control.
- Advanced ticket analytics and reporting.
- SLA tracking and escalation management.
- AI-powered ticket classification and prioritization.
- Knowledge base and self-service support portal.
- Real-time ticket updates.

## What I Learned

Through building ResolveIT, I gained practical experience in:

- Full-stack application development.
- REST API development and integration.
- JWT authentication and protected routes.
- Database integration using SQLite and AWS DynamoDB.
- Cloud deployment using Vercel and Render.
- Environment variable management.
- Debugging production deployment issues.
- Git and GitHub version control.

## Author

**Chapala Praveen**

Computer Science & Engineering | AI & ML

<p align="left">
  <a href="https://github.com/praveenchapala">
    <img src="https://img.shields.io/badge/GitHub-Praveen%20Chapala-181717?style=for-the-badge&logo=github" />
  </a>
</p>

---

<p align="center">
  <b>ResolveIT — Less Disruption. More Resolution.</b>
</p>

<p align="center">
  If you find this project useful, consider giving the repository a star!
</p>
