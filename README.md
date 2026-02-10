# Pariskq CRM – Frontend 
## Overview

This repository contains the **frontend web application** for the Pariskq CRM and Field Operations platform.

This repository contains the frontend application for the Pariskq CRM and Field Operations platform.

The application is used by internal teams to:
View and manage incoming complaints and tickets
Track ticket status and assignments
Upload and view ticket-related documents (images, proofs, etc.)
Monitor resolution workflows
The frontend communicates with a backend API that handles business logic, data storage, and integrations.

---
## 2. High Level Description
At a high level, this application provides a web interface for managing operational tickets that originate from incoming emails or field complaints.

Users can:
Log in to the system
View a list of tickets
Open individual tickets to see details
Assign or reassign tickets
Upload supporting documents
Track the lifecycle of a ticket from creation to resolution

This application does not store data by itself.
All data is fetched from and sent to the backend service via secure APIs.

---

## 3. Technology Stack

| Category        | Technology               |
|-----------------|--------------------------|
| Framework       | React                    |
| Language        | TypeScript               |
| Build Tool      | Vite                     |
| Styling         | CSS / utility-based CSS  |
| Routing         | Client-side routing      |
| API Protocol    | REST (JSON over HTTP)    |
| Auth Model      | Token-based (via backend)|
| Deployment      | AWS (company-managed)    |

---

Rules:
- `.env` files must not be committed
- Production values are injected via AWS
- All frontend variables must be prefixed with `VITE_`

---

## 4. Architecture Overview

This frontend is part of a multi-tier system and does not operate independently.

High-level architecture:

Browser (User)
→ React Frontend (this application)
→ Backend API (Node.js / Express)
→ PostgreSQL (Application data)
→ AWS S3 (Ticket attachments)

Key architectural decisions:
- The frontend is stateless
- All business logic is enforced in the backend
- The frontend never directly accesses the database or object storage
- File uploads are routed through the backend for security and auditing

---

## 5. Repository Structure

High-level structure of the codebase:

src/
- components/    Reusable UI components (buttons, modals, layouts)
- pages/         Route-level screens (dashboard, tickets, login)
- services/      API interaction layer (HTTP requests)
- utils/         Helper functions and constants
- assets/        Static assets (icons, images)
- routes.tsx     Application route definitions
- App.tsx        Root component
- main.tsx       Application entry point

The separation between pages, components, and services should be preserved when adding new features.

---

## 6. API Interaction Pattern

All communication with the backend happens through the service layer.

Guidelines:
- UI components must not call APIs directly
- All HTTP requests should be implemented in the services folder
- Services return structured data to pages/components
- Error handling should be centralized where possible

This pattern ensures:
- Easier debugging
- Clear separation of concerns
- Easier backend API changes

---

## 7. Local Development

### Prerequisites
- Node.js (LTS recommended)
- npm or yarn

### Install Dependencies
```bash
npm install
Run Development Server
npm run dev
Production Build
npm run build
```
This generates a static production build suitable for deployment on AWS infrastructure.

## 8. Screenshots (Documentation)

Login Screen
<!-- Screenshot: Login Page -->
Dashboard
<!-- Screenshot: Dashboard -->

<img width="1919" height="866" alt="image" src="https://github.com/user-attachments/assets/6eeeadb8-8482-40c5-a9d5-7fe2c54709a6" />
All Ticket 
<!-- Screenshot: Ticket List -->
<img width="1912" height="868" alt="image" src="https://github.com/user-attachments/assets/a46132c5-7cc1-42d2-bd76-658a77d0328a" />
Ticket Detail & Attachments
<!-- Screenshot: Ticket Detail -->
<img width="1919" height="860" alt="image" src="https://github.com/user-attachments/assets/049c6122-4a42-449f-9267-a28a543cc454" />

Field Executive List
<!-- Screenshot: Field Executive  -->
<img width="1919" height="863" alt="image" src="https://github.com/user-attachments/assets/dba1b4c8-1f30-43fd-a3ed-6ac02cfbdfbc" />

Field Executive Assignment
<!-- Screenshot: Field Executive Assignment -->
<img width="1919" height="863" alt="image" src="https://github.com/user-attachments/assets/a27178a8-b857-4dd6-aeaa-e54adb82d19c" />

Field Executive Dashboard
<!-- Screenshot: Field Executive View -->
<img width="960" height="623" alt="image" src="https://github.com/user-attachments/assets/3d6630f2-c99b-4143-939a-8d82e7050da7" />



## 9. Security Considerations
No secrets stored in frontend code
No hardcoded credentials or endpoints
All API calls require authentication
Authorization is enforced by backend
File access is controlled and time-bound

## 10. Deployment Notes
Repository is hosted under the company GitHub organization
CI/CD and hosting are handled via AWS
Environment variables are injected at deployment time
Frontend and backend are deployed independently

### 11. Development Guidelines
Keep UI components presentation-focused
Use service layer for all API communication
Avoid embedding business logic in components
Maintain existing folder structure
Do not bypass backend for data or storage access



