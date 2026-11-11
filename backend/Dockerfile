FROM python:3.12-slim
WORKDIR /app
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir -r backend/requirements.txt
COPY backend /app/backend
COPY data /app/data
COPY demo /app/demo
ENV DL_DATA_DIR=/app/data DL_STATE_DIR=/app/state DL_DEMO_DIR=/app/demo
WORKDIR /app/backend
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
