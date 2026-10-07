# ADR-3-01 — Cifrado de secretos de webhook en reposo
- Estado: Aceptado · Fecha: 2026-10-07 · Fase/Tarea: F3 / WHK-02
## Contexto
Las suscripciones almacenan un secreto usado para firmar entregas. El plan exige que permanezca cifrado en reposo y que nunca se devuelva ni se registre en claro.
## Decisión
El servicio cifra cada secreto con AES-256-GCM mediante la variable `WEBHOOK_SECRET_ENCRYPTION_KEY`, codificada en base64 y de exactamente 32 bytes. El ciphertext incluye IV y tag de autenticación.
## Consecuencias
Se debe crear y conceder al runtime del servicio el secreto `webhooks-secret-encryption-key`. En PowerShell, el humano debe ejecutar: `$bytes = [byte[]]::new(32); [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes); $secret = [Convert]::ToBase64String($bytes); $secret | gcloud secrets create webhooks-secret-encryption-key --data-file=- --project <PROJECT_ID>` y luego `gcloud secrets add-iam-policy-binding webhooks-secret-encryption-key --member="serviceAccount:webhooks-service-runtime@<PROJECT_ID>.iam.gserviceaccount.com" --role="roles/secretmanager.secretAccessor" --project <PROJECT_ID>`. La rotación de esta clave queda fuera del MVP.
