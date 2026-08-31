# Payroll

## Development

Backend:

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload
```

Frontend:

```bash
cd frontend
npm install
npm run dev
```

Environment files are intentionally excluded from Git. Copy the required
PostgreSQL connection values into `backend/.env` and set `VITE_API_URL` in
`frontend/.env` when the API is not running at `http://127.0.0.1:8000/api`.
