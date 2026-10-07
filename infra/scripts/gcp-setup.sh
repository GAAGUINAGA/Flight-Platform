#!/usr/bin/env bash
set -euo pipefail

: "${REGION:?Set REGION (for example us-east1)}"
: "${GITHUB_REPO:?Set GITHUB_REPO (owner/repository)}"
[[ "$GITHUB_REPO" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo 'Invalid GITHUB_REPO' >&2; exit 1; }

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
[[ -n "$PROJECT_ID" && "$PROJECT_ID" != '(unset)' ]] || { echo 'Select a GCP project first' >&2; exit 1; }
PROJECT_NUMBER="$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')"

REPOSITORY='flight-platform'
POOL='github-actions'
PROVIDER='flight-platform'
DEPLOY_ACCOUNT="flight-platform-deployer@${PROJECT_ID}.iam.gserviceaccount.com"
HELLO_ACCOUNT="hello-service-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
SECRET='internal-api-key'

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  iamcredentials.googleapis.com \
  iam.googleapis.com \
  sts.googleapis.com \
  --project="$PROJECT_ID" --quiet

if ! gcloud artifacts repositories describe "$REPOSITORY" --location="$REGION" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud artifacts repositories create "$REPOSITORY" \
    --repository-format=docker --location="$REGION" \
    --description='Flight Platform service images' --project="$PROJECT_ID" --quiet
fi

if ! gcloud iam service-accounts describe "$DEPLOY_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create flight-platform-deployer \
    --display-name='Flight Platform GitHub deployment' --project="$PROJECT_ID" --quiet
fi
if ! gcloud iam service-accounts describe "$HELLO_ACCOUNT" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create hello-service-runtime \
    --display-name='Flight Platform hello runtime' --project="$PROJECT_ID" --quiet
fi

if ! gcloud iam workload-identity-pools describe "$POOL" --location=global --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$POOL" \
    --location=global --display-name='GitHub Actions' --project="$PROJECT_ID" --quiet
fi
if ! gcloud iam workload-identity-pools providers describe "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers create-oidc "$PROVIDER" \
    --location=global --workload-identity-pool="$POOL" \
    --issuer-uri='https://token.actions.githubusercontent.com/' \
    --attribute-mapping='google.subject=assertion.sub,attribute.repository=assertion.repository' \
    --attribute-condition="assertion.repository=='${GITHUB_REPO}' && assertion.ref=='refs/heads/main'" \
    --project="$PROJECT_ID" --quiet
fi

PRINCIPAL="principalSet://iam.googleapis.com/projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/attribute.repository/${GITHUB_REPO}"
gcloud iam service-accounts add-iam-policy-binding "$DEPLOY_ACCOUNT" \
  --member="$PRINCIPAL" --role='roles/iam.workloadIdentityUser' \
  --project="$PROJECT_ID" --quiet >/dev/null
gcloud artifacts repositories add-iam-policy-binding "$REPOSITORY" \
  --location="$REGION" --member="serviceAccount:${DEPLOY_ACCOUNT}" \
  --role='roles/artifactregistry.writer' --project="$PROJECT_ID" --quiet >/dev/null
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:${DEPLOY_ACCOUNT}" --role='roles/run.admin' \
  --quiet >/dev/null
gcloud iam service-accounts add-iam-policy-binding "$HELLO_ACCOUNT" \
  --member="serviceAccount:${DEPLOY_ACCOUNT}" --role='roles/iam.serviceAccountUser' \
  --project="$PROJECT_ID" --quiet >/dev/null

if ! gcloud secrets describe "$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  gcloud secrets create "$SECRET" --replication-policy=automatic \
    --project="$PROJECT_ID" --quiet >/dev/null
fi
if ! gcloud secrets versions describe latest --secret="$SECRET" --project="$PROJECT_ID" >/dev/null 2>&1; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  LOCAL_ENV="${SCRIPT_DIR}/../../microservices/inventory-service/.env"
  local_key=''
  if [[ -f "$LOCAL_ENV" ]]; then
    local_key="$(sed -n 's/^INTERNAL_API_KEY=//p' "$LOCAL_ENV" | head -n 1)"
  fi
  production_key="$(openssl rand -hex 32)"
  while [[ "$production_key" == "$local_key" ]]; do
    production_key="$(openssl rand -hex 32)"
  done
  printf '%s' "$production_key" | gcloud secrets versions add "$SECRET" \
    --data-file=- --project="$PROJECT_ID" --quiet >/dev/null
  unset production_key local_key
fi
gcloud secrets add-iam-policy-binding "$SECRET" \
  --member="serviceAccount:${HELLO_ACCOUNT}" --role='roles/secretmanager.secretAccessor' \
  --project="$PROJECT_ID" --quiet >/dev/null

for service in inventory pricing ancillaries reservation ticketing operations webhooks; do
  runtime_account="${service}-service-runtime@${PROJECT_ID}.iam.gserviceaccount.com"
  if ! gcloud iam service-accounts describe "$runtime_account" --project="$PROJECT_ID" >/dev/null 2>&1; then
    gcloud iam service-accounts create "${service}-service-runtime" \
      --display-name="Flight Platform ${service} runtime" --project="$PROJECT_ID" --quiet
  fi
  gcloud iam service-accounts add-iam-policy-binding "$runtime_account" \
    --member="serviceAccount:${DEPLOY_ACCOUNT}" --role='roles/iam.serviceAccountUser' \
    --project="$PROJECT_ID" --quiet >/dev/null
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:${runtime_account}" --role='roles/secretmanager.secretAccessor' \
    --project="$PROJECT_ID" --quiet >/dev/null
done

echo "WIF_PROVIDER=projects/${PROJECT_NUMBER}/locations/global/workloadIdentityPools/${POOL}/providers/${PROVIDER}"
echo "DEPLOY_SERVICE_ACCOUNT=${DEPLOY_ACCOUNT}"
