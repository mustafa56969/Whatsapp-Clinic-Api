# 🏥 Mustafa AI Clinic Bot

A WhatsApp Business API automation system for managing clinic appointments, patient queue, and AI-powered customer support in Roman Urdu.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green)
![WhatsApp](https://img.shields.io/badge/WhatsApp-API-blue)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-orange)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## 📋 Table of Contents

- [Overview](#overview)
- [Features](#features)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Environment Variables](#environment-variables)
- [Project Structure](#project-structure)
- [How It Works](#how-it-works)
- [API Endpoints](#api-endpoints)
- [Firebase Setup](#firebase-setup)
- [WhatsApp Business Setup](#whatsapp-business-setup)
- [OpenRouter AI Setup](#openrouter-ai-setup)
- [Deployment](#deployment)
- [Screenshots](#screenshots)
- [License](#license)

---

## 🎯 Overview

This project is a complete WhatsApp clinic automation bot that handles:

- **Appointment Booking** - Patients can book appointments via WhatsApp
- **Queue Management** - Real-time queue status and token system
- **Doctor Information** - Fees, timings, availability display
- **AI Chat Support** - Intelligent Roman Urdu responses via OpenRouter
- **Number Lookup** - Check existing bookings by phone number
- **Cancellation** - Cancel appointments easily

The bot responds in **Roman Urdu** (Urdu written in Latin script) and uses a combination of interactive buttons, lists, and AI-powered responses.

---

## ✨ Features

### 1. **Appointment Booking System**
- Interactive date selection from available dates
- Patient name and phone number collection
- Problem/symptom recording (optional)
- Automatic token number generation
- Confirmation with all booking details

### 2. **Queue Management**
- Real-time queue status display
- Current serving token number
- Waiting patient count
- Position tracking ("Aap se pehle: X log")

### 3. **Doctor Information**
- Doctor name and specialization
- Consultation fees display
- Available days and timings
- Clinic address and phone

### 4. **Number Lookup**
- Search bookings by phone number
- Shows all active bookings for a number
- Token number and status display

### 5. **Booking Cancellation**
- Cancel existing appointments
- Confirmation before cancellation

### 6. **AI-Powered Chat**
- OpenRouter API integration
- Roman Urdu responses
- Fallback for unrecognized queries

### 7. **Admin API**
- View queue status
- Get/manage doctor info
- Send manual messages to patients

---

## 🏗️ Architecture

```
                    ┌─────────────────┐
                    │  WhatsApp User  │
                    └────────┬────────┘
                             │ WhatsApp API
                             ▼
                    ┌─────────────────┐
                    │   Webhook       │
                    │  /webhook       │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
              ▼              ▼              ▼
        ┌──────────┐  ┌──────────┐  ┌──────────┐
        │ Button   │  │  List    │  │   AI     │
        │ Handler  │  │ Response │  │  Chat    │
        └────┬─────┘  └────┬─────┘  └────┬─────┘
             │             │             │
             └─────────────┼─────────────┘
                           ▼
                  ┌─────────────────┐
                  │   Firebase      │
                  │   Firestore     │
                  └─────────────────┘
```

---

## 📦 Prerequisites

Before installing, ensure you have:

- **Node.js** v18 or higher
- **npm** or **yarn**
- **Firebase Project** with Firestore enabled
- **WhatsApp Business API** access (Meta Developer)
- **OpenRouter API** key for AI responses

---

## 🚀 Installation

### 1. Clone or Download

```bash
# Navigate to project directory
cd whatsapp-clinic-api
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Configure Environment Variables

You have two options:

#### Option A: Replit Secrets (Recommended for Replit)
If deploying on Replit, add secrets in the **Secrets** tab:
- `WHATSAPP_TOKEN`
- `PHONE_NUMBER_ID`
- `VERIFY_TOKEN`
- `OPENROUTER_KEY`
- `ADMIN_SECRET`
- `REPLIT_URL`

These are automatically available as environment variables.

#### Option B: Local .env File
Create a `.env` file in the root directory (see **Environment Variables** section below).

### 4. Add Firebase Service Account

Place your `serviceAccountKey.json` file in the root directory (downloaded from Firebase Console).

### 5. Start the Server

```bash
# Development
node index.js

# Or with nodemon
npx nodemon index.js
```

---

## 🔐 Environment Variables

Environment variables can be configured in two ways:

### Option 1: Replit Secrets (Recommended for Replit)
In Replit, add these secrets in the **Secrets** tab (Tools → Secrets):
- `WHATSAPP_TOKEN` - Meta WhatsApp Access Token
- `PHONE_NUMBER_ID` - WhatsApp Phone Number ID
- `VERIFY_TOKEN` - Webhook verification token
- `OPENROUTER_KEY` - OpenRouter API key for AI
- `ADMIN_SECRET` - Secret for admin API
- `REPLIT_URL` - Self-ping URL (optional)

> **Note:** Replit secrets and `.env` file serve the same purpose — both are accessed via `process.env.VARIABLE_NAME`. The code automatically reads from whichever method you use.

### Option 2: Local .env File
Create a `.env` file in the root directory:

| Variable | Description | Example |
|----------|-------------|---------|
| `WHATSAPP_TOKEN` | Meta WhatsApp Access Token | `EAALiw...` |
| `PHONE_NUMBER_ID` | WhatsApp Phone Number ID | `1234567890123456` |
| `VERIFY_TOKEN` | Webhook verification token | `mustafa123` |
| `OPENROUTER_KEY` | OpenRouter API key for AI | `sk-or-v1-...` |
| `ADMIN_SECRET` | Secret for admin API | `mustafa123` |
| `PORT` | Server port (default: 3000) | `3000` |
| `REPLIT_URL` | Self-ping URL for Replit | `https://...replit.app` |

### Sample `.env` file:

```env
WHATSAPP_TOKEN=YOUR_WHATSAPP_ACCESS_TOKEN
PHONE_NUMBER_ID=1234567890123456
VERIFY_TOKEN=your_verify_token
OPENROUTER_KEY=sk-or-v1-your_openrouter_key
ADMIN_SECRET=your_admin_secret
PORT=3000
REPLIT_URL=https://nodejs--yourname.replit.app
```

> **Important:** Never commit your `.env` file or `serviceAccountKey.json` to version control!

---

## 📂 Project Structure

```
whatsapp-clinic-api/
│
├── index.js                 # Main application file (953 lines)
├── serviceAccountKey.json   # Firebase service account (DO NOT SHARE)
├── .env                     # Environment variables (DO NOT SHARE)
├── package.json             # Dependencies
├── README.md                # This file
└── .gitignore               # Git ignore rules
```

---

## ⚙️ How It Works

### 1. **User Sends Message**
When a user sends a message to the WhatsApp number, Meta's servers send a POST request to your webhook.

### 2. **Webhook Processing**
The `app.post('/webhook')` handler:
- Extracts the message text or button ID
- Passes to the `handle()` function

### 3. **Flow Handling**
The `handle(phone, text, btnId)` function:

#### **Button Responses:**
- `BOOK` → Start appointment booking flow
- `QUEUE` → Show current queue status
- `DOCTOR` → Display doctor information
- `NUM_LOOKUP` → Ask for phone number to search
- `DO_CANCEL` → Cancel existing booking

#### **Text Processing:**
- **Greetings** (hi, hello, salam) → Show welcome menu
- **Token number** (e.g., "5") → Show booking details for that token
- **Keywords** (doctor, book, cancel, queue) → Respective actions
- **Unknown** → AI chat fallback

### 4. **Firebase Storage**
- `clinics/{clinicId}/queues/{date}/patients/{patientId}` - Patient bookings
- `clinics/{clinicId}/queues/{date}/meta/info` - Queue metadata
- `clinics/{clinicId}/doctors/{doctorId}` - Doctor information
- `wa_patients/{phone}` - User conversation state

### 5. **Response Sending**
- Buttons (max 3) - For simple actions
- Lists (up to 10 options) - For date selection
- Text messages - For detailed info

---

## 🌐 API Endpoints

### Health Check

```bash
GET /
# Response: ✅ Mustafa Clinic Bot v16 LIVE
```

### Webhook Verification

```bash
GET /webhook?hub.verify_token=mustafa123&hub.challenge=CHALLENGE
# Response: Challenge string (for Meta verification)
```

### Admin: Queue Status

```bash
GET /admin/queue?date=2026-04-12
Authorization: Bearer mustafa123

# Response: JSON with queue status and patient list
```

### Admin: Doctor Info

```bash
GET /admin/doctor
Authorization: Bearer mustafa123

# Response: Doctor details
```

### Admin: Send Message

```bash
POST /admin/send
Authorization: Bearer mustafa123
Content-Type: application/json

{
  "phone": "923001234567",
  "message": "Your appointment is confirmed!"
}

# Response: { ok: true, status: "✅ Message sent" }
```

---

## 🔥 Firebase Setup

### 1. Create Firebase Project
- Go to [console.firebase.google.com](https://console.firebase.google.com)
- Create a new project

### 2. Enable Firestore
- Go to **Firestore Database** → Create Database
- Choose location (e.g., asia-south1)
- Start in **Production Mode**

### 3. Get Service Account
- Go to **Project Settings** → **Service Accounts**
- Click **Generate New Private Key**
- Download the JSON file
- Rename to `serviceAccountKey.json`
- Place in project root

### 4. Firestore Data Structure

```
clinics/
└── default_clinic/
    ├── doctors/
    │   └── (auto-created)
    │       └── name: "Dr. Mustafa"
    │       └── specialization: "General Physician"
    │       └── consultationFee: 1000
    │       └── timings: "9AM - 5PM"
    │       └── availableDays: [1,2,3,4,5]
    │       └── address: "Clinic Address"
    │       └── phone: "03001234567"
    │
    └── queues/
        └── 2026-04-12/
            ├── meta/
            │   └── info/
            │       ├── lastToken: 5
            │       └── currentServingToken: 3
            │
            └── patients/
                └── (auto-created)
                    ├── name: "John Doe"
                    ├── phone: "923001234567"
                    ├── token: 4
                    ├── status: "waiting" | "in_progress" | "cancelled"
                    ├── problem: "Headache"
                    └── createdAt: timestamp
```

---

## 📱 WhatsApp Business Setup

### 1. Meta Developer Account
- Go to [developers.facebook.com](https://developers.facebook.com)
- Create an app (choose "Other" → "Business")

### 2. WhatsApp Product
- Add **WhatsApp** to your app
- Select your business phone number

### 3. Get Credentials
- **Phone Number ID**: Found in WhatsApp API setup
- **Access Token**: Temporary token (expires 24h)
- For production, set up a permanent token via Meta Business Manager

### 4. Configure Webhook
- Your webhook URL: `https://your-domain.com/webhook`
- Verify token: `mustafa123` (or your custom token)

### 5. Subscribe to Events
- Subscribe to `messages` in webhook configuration

---

## 🤖 OpenRouter AI Setup

### 1. Create Account
- Go to [openrouter.ai](https://openrouter.ai)
- Sign up and verify email

### 2. Get API Key
- Go to **Keys** → Create New Key
- Copy the key (starts with `sk-or-v1-`)

### 3. Configure in .env
```
OPENROUTER_KEY=sk-or-v1-xxxxxxxxxxxxxxxxxxxxx
```

### 4. Model Used
The bot uses: `arcee-ai/trinity-large-preview:free`
- Free tier model
- Optimized for chat responses
- Context window: sufficient for clinic queries

### System Prompt
The AI is configured with:
```
Tu Mustafa Clinic ka sahayak hai. Sirf Roman Urdu mein jawab do. 
Max 2 lines. Simple Pakistani alfaaz use karo.
```

---

## 🚀 Deployment

### Option 1: Replit (Recommended for Beginners)

1. **Upload Files**
   - Create a new Replit Node.js project
   - Upload `index.js`, `serviceAccountKey.json`
   - Create `.env` in Secrets tab

2. **Configure Webhook**
   - Note your Replit URL: `https://nodejs--username.replit.app`
   - Add to `.env`: `REPLIT_URL=https://nodejs--username.replit.app`

3. **Set Up Webhook**
   - In Meta WhatsApp Dashboard, set webhook URL
   - Use same URL for both GET and POST `/webhook`

### Option 2: Render / Railway / Heroku

1. Push code to GitHub
2. Connect to deployment platform
3. Add environment variables
4. Deploy

### Option 3: VPS (DigitalOcean, AWS, etc.)

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Clone and install
git clone your-repo
cd whatsapp-clinic-api
npm install

# Run with PM2
pm2 start index.js --name clinic-bot

# Configure Nginx for webhook
```

---

## 📸 Screenshots

> **Note:** Add your 4 screenshots here by placing them in the project and referencing them.

### 1. Welcome Message
![Welcome Message](screenshots/welcome.png)

### 2. Appointment Booking Flow
![Booking Flow](screenshots/booking.png)

### 3. Queue Status Display
![Queue Status](screenshots/queue.png)

### 4. Doctor Information
![Doctor Info](screenshots/doctor.png)

---

## 🔧 Troubleshooting

### Issue: Webhook not verifying
- Check your server is running: `node index.js`
- Verify token matches in Meta dashboard
- Check logs: should show "🏥 MUSTAFA CLINIC BOT v16"

### Issue: Messages not sending
- Verify `WHATSAPP_TOKEN` is valid
- Check token hasn't expired
- Verify `PHONE_NUMBER_ID` is correct

### Issue: AI not responding
- Check `OPENROUTER_KEY` is valid
- Verify internet connection
- Check model name in code

### Issue: Firebase errors
- Verify `serviceAccountKey.json` is correct
- Check Firestore is enabled
- Verify project ID matches

---

## 📝 Configuration Options

### Change Doctor Information
Edit in Firebase Firestore:
```
clinics/default_clinic/doctors/ (document)
```

### Change Working Days
Update `availableDays` array in doctor document:
- 1 = Monday
- 2 = Tuesday
- ...
- 7 = Sunday

### Add Unavailable Dates
Add to doctor document:
```json
{
  "unavailableDates": ["2026-04-15", "2026-04-20"]
}
```

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

---

## 📄 License

This project is licensed under the **MIT License**.

---

## 🙏 Acknowledgments

- **Meta** for WhatsApp Business API
- **Firebase** for database and authentication
- **OpenRouter** for AI capabilities
- All contributors and testers

---

## 📞 Support

For issues or questions:
- Open an issue on GitHub
- Check existing issues first

---

**Made with ❤️ for Healthcare Automation**

Version: v16
Last Updated: April 2026
