FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8080

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install -r /app/requirements.txt

COPY services/enqueue /app/services/enqueue

EXPOSE 8080

CMD ["python", "-m", "uvicorn", "services.enqueue.app:app", "--host", "0.0.0.0", "--port", "8080"]

