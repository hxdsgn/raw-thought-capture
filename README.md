# Aha! - Raw Thought Capture 🧠

A minimalist, "dumb", and fast Chrome Extension for capturing raw thoughts, code snippets, and ideas directly to Firebase Firestore.

It is designed to be the "Short-Term Memory" (RAM) of your workflow. It captures context rapidly without getting in the way, then syncs to the cloud for processing by your "Smart" second brain applications later.

## ✨ Features

- **Zero-Friction Capture:** Open, type, Enter.
- **Markdown Support:** Renders code blocks and formatting instantly.
- **Context Awareness:** Saves `Page Title` and `URL` automatically.
- **"Ghost" Processing:** Local-first architecture. It works offline and syncs when you tell it to.
- **BYOK (Bring Your Own Keys):** Configurable Firebase settings via the UI. No hardcoded secrets.

## 🛠️ Installation (For Developers)

Since this is a private tool made public, you must build it yourself.

### 1. Clone the Repo

```bash
git clone https://github.com/hxdsgn/raw-thought-capture.git
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Build the Extension

This compiles the code and generates the dist/ folder.

```bash
npm run build
```

### 4. Load into Chrome

1. Open Chrome and go to chrome://extensions.

2. Toggle Developer Mode (top right).

3. Click Load Unpacked.

4. Select the dist folder generated in step 3.

# ⚙️ Configuration (Crucial Step)

The extension will open in "Local-Only Mode" by default. To enable Cloud Sync, you need a Firebase Project & Google Cloud Setup.

### 1. Create a Firebase Project

Go to [console.firebase.google.com](https://console.firebase.google.com) and create a project.

### 2. Enable Authentication

1. Go to **Build > Authentication > Sign-in method**.
2. Click **Add new provider** > **Google**.
3. Enable it and click **Save**.

### 3. Create Google OAuth Client ID (For the Extension)

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials).
2. Click **Create Credentials > OAuth client ID**.
3. Application Type: **Web application** (NOT Chrome Extension).
4. Name: "Aha Extension".
5. **Authorized redirect URIs (Critical):**
   - You need your Extension ID. Open the extension in Chrome, go to `chrome://extensions`, copy the ID (e.g., `ofgjon...`).
   - Add this URI: `https://<YOUR_EXTENSION_ID>.chromiumapp.org/`
6. Click **Create** and copy your **Client ID**.

### 4. Whitelist Client ID in Firebase (Critical)

_If you skip this, you will get an `auth/invalid-credential` error._

1. Go back to **Firebase Console > Authentication > Sign-in method**.
2. Click the **Pencil Icon** next to Google.
3. Scroll to **Whitelist client IDs from external projects**.
4. Paste your **Client ID** and click **Add**, then **Save**.

### 5. Enable Firestore Database

1. Go to **Build > Firestore Database**.
2. Create Database (Start in production mode).
3. Set Rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 6. Configure the Extension

1. Open the **Aha! Extension**.
2. Click the **Settings (Gear)** icon.
3. Go to the **Config** tab.
4. Paste your **OAuth Client ID**.
5. Paste your **Firebase Keys** (found in Project Settings > General > Web App).
6. Click **Save & Reload**.

# ⌨️ Usage

- Capture: Cmd/Ctrl+Shift+U (or click the icon).

- New Line: Shift+Enter.

- Submit: Enter or click Capture.

- Markdown Preview: Click the "Eye" icon in the header.

- Sync: Go to Settings > Context > "Sync from Firebase".

# 🏗️ Tech Stack

- Vite (Build Tool)

- Firebase SDK 9 (Modular)

- Vanilla JS (No heavy frameworks, pure DOM manipulation for speed)

- Vibecoded don't expecxt funny stuff

# 📄 License

- MIT
