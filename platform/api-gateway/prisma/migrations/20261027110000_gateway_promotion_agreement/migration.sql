-- F12a P6 (ADR-F12-10): acuerdo B2B de promociones por cliente OAuth (GET/PUT /vuelos/promociones/contrato).
CREATE TABLE gateway.promotion_agreement (
  client_id TEXT PRIMARY KEY,
  permite_promociones BOOLEAN NOT NULL,
  porcentaje_descuento_maximo NUMERIC(5,2) NOT NULL,
  destinos_habilitados TEXT[] NOT NULL DEFAULT '{}',
  rutas_habilitadas TEXT[] NOT NULL DEFAULT '{}',
  cabinas_habilitadas TEXT[] NOT NULL DEFAULT '{}',
  vigencia_hasta VARCHAR(10),
  condiciones_combo TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
