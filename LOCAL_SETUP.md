# Local Setup Guide (MacOS)

Follow these steps to run **Auction Pro** locally on your Mac. Running locally is much more reliable for Google OAuth and allows you to use it as a desktop application.

## 1. Export the Code
1. In AI Studio, click the **Settings** (gear icon) in the bottom left.
2. Click **Export to ZIP**.
3. Unzip the folder on your Mac.

## 2. Prerequisites
- **Node.js**: Install **version 20 or higher** (LTS) from [nodejs.org](https://nodejs.org/). 
  - *Note: Versions lower than 20 may cause "crypto.getRandomValues" errors during the build.*
- **Terminal**: You will use the `Terminal` app on your Mac.

## 3. Install Dependencies
Open your Terminal, navigate to the unzipped folder, and run:
```bash
npm install
```

## 4. Set up Google Credentials
1. Go to the [Google Cloud Console](https://console.cloud.google.com/).
2. Select your project.
3. Go to **APIs & Services > Credentials**.
4. Edit your **OAuth 2.0 Client ID**.
5. Add `http://localhost:3000/auth/callback` to the **Authorised redirect URIs** list.
6. Click **Save**.

## 5. Configure Environment Variables
Create a file named `.env` in the root of the project and paste your credentials:
```env
GOOGLE_CLIENT_ID=your_client_id_here
GOOGLE_CLIENT_SECRET=your_client_secret_here
SESSION_SECRET=a_random_long_string
APP_URL=http://localhost:3000
GEMINI_API_KEY=your_gemini_key_if_using_assistant
```

## 6. How to Run

### Option A: As a Desktop App (Recommended)
This opens the app in its own window, like a native Mac application.
```bash
# First, build the frontend
npm run build

# Then start the app
npm run dev:desktop
```

### Option B: In your Browser
```bash
npm run dev
# Then open http://localhost:3000 in Chrome/Safari
```

---

## Troubleshooting OAuth
If you still get `redirect_uri_mismatch`, double-check that the URI in the Google Cloud Console exactly matches `http://localhost:3000/auth/callback`. Localhost is much more forgiving than the preview URLs.
