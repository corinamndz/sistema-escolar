-- =====================================================================
-- 008 — Comprobante (soporte) adjunto a un pago
--
-- El archivo vive en storage/payment-proofs/<tenant>/<uuid>.<ext>, FUERA de las
-- carpetas servidas como estáticas: contiene datos bancarios, así que solo se
-- descarga por GET /api/payments/:id/proof, que verifica quién lo pide.
-- =====================================================================

ALTER TABLE payments
  ADD COLUMN proof_path           TEXT,          -- ruta relativa a storage/ (nunca una URL pública)
  ADD COLUMN proof_mime           VARCHAR(50) CHECK (proof_mime IS NULL OR proof_mime IN ('image/jpeg', 'image/png', 'application/pdf')),
  ADD COLUMN proof_original_name  VARCHAR(255),
  ADD COLUMN proof_size           INTEGER CHECK (proof_size IS NULL OR proof_size > 0),
  ADD COLUMN proof_uploaded_at    TIMESTAMPTZ,
  ADD CONSTRAINT payments_proof_fields CHECK (
    (proof_path IS NULL AND proof_mime IS NULL) OR (proof_path IS NOT NULL AND proof_mime IS NOT NULL)
  );
