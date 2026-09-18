# Expense Tracker

A full-stack expense management app built for tracking daily spending, categorizing expenses, and viewing leaderboard rankings for users.

## Features

- User signup and login
- Password hashing with Node.js crypto
- Expense creation, listing, and deletion
- User-specific expense data
- Automatic expense categorization
- Fallback keyword-based categorization when AI is not configured
- Leaderboard with total spending per user
- Transaction-safe data writes using snapshot rollback
- Static frontend served by the Express backend

## Tech Stack

- Backend: Node.js, Express
- Frontend: HTML, CSS, JavaScript
- Data storage: JSON files in the backend data folder
- AI categorization: OpenRouter-compatible API

## Project Structure

```text
expense-tracker/
├── backend/
│   ├── app.js
│   ├── package.json
│   ├── controllers/
│   ├── data/
│   │   ├── expenses.json
│   │   └── users.json
│   ├── middleware/
│   ├── models/
│   ├── routes/
│   ├── tests/
│   └── utils/
├── frontend/
│   ├── css/
│   ├── js/
│   ├── expenses.html
│   ├── forgot-password.html
│   ├── leaderboard.html
│   ├── login.html
│   ├── report.html
│   ├── reset-password.html
│   └── signup.html
├── README.md
├── vercel.json
└── package.json
```

## Prerequisites

- Node.js 18 or higher
- npm

## Getting Started

1. Open a terminal and go to the backend folder:

```bash
cd backend
```

2. Install dependencies:

```bash
npm install
```

3. Start the server:

```bash
npm start
```

4. Open the app in the browser:

```text
http://localhost:3001
```

The backend serves the frontend files, so the login page is available from the root URL.

## Deploy on GitHub and Vercel

1. Create a new GitHub repository and push this project:

```bash
git init
git add .
git commit -m "Prepare expense tracker for Vercel"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPOSITORY.git
git push -u origin main
```

2. In Vercel, import the GitHub repository. Keep the framework preset as `Other` and leave the build command empty.
3. Add the `OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_SITE_URL`, and `OPENROUTER_APP_NAME` environment variables in Vercel Project Settings.
4. Deploy. The `vercel.json` file routes both the frontend and `/api/*` requests to the Express app.

Vercel serverless storage is temporary. The JSON files work for local development, but signup and expense changes should use a hosted database for reliable production persistence.

## Environment Variables

Expense categorization can use an external AI provider via OpenRouter. If you do not configure it, the app automatically falls back to local keyword matching.

### Optional AI setup

On Windows PowerShell:

```powershell
$env:OPENROUTER_API_KEY = "your-api-key"
$env:OPENROUTER_MODEL = "openai/gpt-4o-mini"
$env:OPENROUTER_SITE_URL = "http://localhost:3001"
$env:OPENROUTER_APP_NAME = "Expense Tracker"
npm start
```

### Behavior

- If the API key is available, the app tries AI-based categorization.
- If the request fails or the key is missing, it uses a fallback category rule.
- Each expense stores both category and category source (for example: ai or fallback).

## API Endpoints

### Authentication

- POST /api/auth/signup
- POST /api/auth/login

### Expenses

- GET /api/expenses?email=user@example.com
- POST /api/expenses
- DELETE /api/expenses/:id?email=user@example.com

### Categorization

- POST /api/categorize-expense
- POST /api/ai/categorize

### Leaderboard

- GET /api/leaderboard?limit=10

## Notes

- User data is stored in backend/data/users.json.
- Expense records are stored in backend/data/expenses.json.
- The app performs transaction-style writes with rollback protection to keep data consistent.

## License

This project is for educational use and is not licensed for production deployment without explicit permission.
