# FinGReaT Web Application

This repository contains the web application with:

- **Backend**: Python Flask (in root `/`)
- **Frontend**: Next.js (in `/webapp`)

---

## 🛠️ Prerequisites

Ensure the following are installed:

- Python 3.8+ and `pip`
- Node.js 18+ and `npm` or `yarn`
- Git
- Virtualenv (optional but recommended)

---

## 📦 Installation

### 1. Clone the Repository

```bash
git clone https://github.com/AbhishekSatpathy4848/MP-Application.git
cd MP-Application
```

### Optional: create virtual environment
```
python3 -m venv venv
source venv/bin/activate   # On Windows: venv\Scripts\activate
```

### Install dependencies
```
pip install -r "requirements.txt"
```

### Create a .env file in the root directory and define variables like:
```
GROQ_API_KEY=
UPSTOX_ACCESS_TOKEN= 
```

### Run Application
```
python app.py
```
By default, the backend will be available at http://localhost:5000/


### Frontend Setup (Next.js)

```
cd webapp
npm install
```

### Create a .env.local file and define variables like:
```
NEXT_PUBLIC_API_URL=<url of backend>
```

### Run the application

```
npm run dev
```

The frontend will be available at http://localhost:3000/


