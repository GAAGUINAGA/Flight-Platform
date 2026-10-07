-- CreateTable
CREATE TABLE "flight_instances" (
    "id" UUID NOT NULL,
    "flight_number" VARCHAR(8) NOT NULL,
    "departure_iata" CHAR(3) NOT NULL,
    "arrival_iata" CHAR(3) NOT NULL,
    "departure_at" TIMESTAMPTZ(3) NOT NULL,
    "arrival_at" TIMESTAMPTZ(3) NOT NULL,
    "aircraft" VARCHAR(32),
    "closed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "flight_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cabin_inventory" (
    "flight_instance_id" UUID NOT NULL,
    "cabin_class" VARCHAR(16) NOT NULL,
    "sellable" INTEGER NOT NULL,
    "held" INTEGER NOT NULL DEFAULT 0,
    "sold" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "cabin_inventory_pkey" PRIMARY KEY ("flight_instance_id","cabin_class")
);

-- CreateTable
CREATE TABLE "holds" (
    "id" UUID NOT NULL,
    "owner_id" VARCHAR(128) NOT NULL,
    "status" VARCHAR(16) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "idempotency_key" VARCHAR(128) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "holds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hold_lines" (
    "hold_id" UUID NOT NULL,
    "flight_instance_id" UUID NOT NULL,
    "cabin_class" VARCHAR(16) NOT NULL,
    "seats" INTEGER NOT NULL,

    CONSTRAINT "hold_lines_pkey" PRIMARY KEY ("hold_id","flight_instance_id","cabin_class")
);

-- CreateTable
CREATE TABLE "reserved_inventory" (
    "id" UUID NOT NULL,
    "hold_id" UUID NOT NULL,
    "owner_id" VARCHAR(128) NOT NULL,
    "flight_instance_id" UUID NOT NULL,
    "cabin_class" VARCHAR(16) NOT NULL,
    "seats" INTEGER NOT NULL,
    "released_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reserved_inventory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "flight_instances_departure_iata_arrival_iata_departure_at_idx" ON "flight_instances"("departure_iata", "arrival_iata", "departure_at");

-- CreateIndex
CREATE UNIQUE INDEX "flight_instances_flight_number_departure_at_key" ON "flight_instances"("flight_number", "departure_at");

-- CreateIndex
CREATE INDEX "holds_status_expires_at_idx" ON "holds"("status", "expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "holds_owner_id_idempotency_key_key" ON "holds"("owner_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "hold_lines_flight_instance_id_cabin_class_idx" ON "hold_lines"("flight_instance_id", "cabin_class");

-- CreateIndex
CREATE INDEX "reserved_inventory_hold_id_idx" ON "reserved_inventory"("hold_id");

-- AddForeignKey
ALTER TABLE "cabin_inventory" ADD CONSTRAINT "cabin_inventory_flight_instance_id_fkey" FOREIGN KEY ("flight_instance_id") REFERENCES "flight_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_lines" ADD CONSTRAINT "hold_lines_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hold_lines" ADD CONSTRAINT "hold_lines_flight_instance_id_fkey" FOREIGN KEY ("flight_instance_id") REFERENCES "flight_instances"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reserved_inventory" ADD CONSTRAINT "reserved_inventory_hold_id_fkey" FOREIGN KEY ("hold_id") REFERENCES "holds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Invariantes de capacidad (BL ?15): held + sold <= sellable
ALTER TABLE "cabin_inventory" ADD CONSTRAINT "cabin_inventory_capacity_chk"
  CHECK ("sellable" >= 0 AND "held" >= 0 AND "sold" >= 0 AND "held" + "sold" <= "sellable");
ALTER TABLE "holds" ADD CONSTRAINT "holds_status_chk"
  CHECK ("status" IN ('HELD', 'RELEASED', 'EXPIRED', 'CONSUMED'));
ALTER TABLE "hold_lines" ADD CONSTRAINT "hold_lines_seats_chk" CHECK ("seats" BETWEEN 1 AND 9);
