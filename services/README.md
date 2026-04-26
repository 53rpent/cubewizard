## Cloud Run services

This folder contains two small HTTP services intended for deployment to Google Cloud Run:

- `enqueue`: called by the Cloudflare upload worker; validates the request and enqueues a Cloud Task
- `worker`: called by Cloud Tasks; processes one upload (download from R2, call LLM, write results, update Firestore status)

Both services are designed to be deployed as container images.

