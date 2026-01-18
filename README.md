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
The extension will open in "Local-Only Mode" by default. To enable Cloud Sync, you need a Firebase Project.

### 1. Create a Firebase Project at console.firebase.google.com.

### 2. Enable Authentication:

* Go to Build > Authentication > Sign-in method.

* Enable Google provider.

### 3. Enable Firestore Database:

* Go to Build > Firestore Database.

* Create Database (Start in production mode).

* Set Rules:
``` javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 4. Get Your Keys:

* Go to Project Settings (Gear Icon) > General > Your apps > Web App.

* Copy apiKey, authDomain, and projectId.

### 5. Configure Extension:

* Open the Extension.

* Click the Settings (Gear) icon.

* Go to the Config tab.

* Paste your keys and click Save & Reload.

⌨️ Usage
* Capture: Cmd/Ctrl+Shift+U (or click the icon).

* New Line: Shift+Enter.

* Submit: Enter or click Capture.

* Markdown Preview: Click the "Eye" icon in the header.

* Sync: Go to Settings > Context > "Sync from Firebase".

🏗️ Tech Stack

* Vite (Build Tool)

* Firebase SDK 9 (Modular)

* Vanilla JS (No heavy frameworks, pure DOM manipulation for speed)

📄 License
* MIT
