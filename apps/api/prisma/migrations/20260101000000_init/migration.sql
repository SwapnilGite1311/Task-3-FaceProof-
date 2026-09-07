-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "demo" BOOLEAN NOT NULL DEFAULT false,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "inputImageHash" TEXT NOT NULL,
    "perceptualHash" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "faceDetected" BOOLEAN NOT NULL DEFAULT false,
    "faceCount" INTEGER NOT NULL DEFAULT 0,
    "faceDetector" TEXT,
    "faceData" JSONB,
    "encodingData" JSONB,
    "reverseSearchProvider" TEXT,
    "reverseSearchData" JSONB,
    "matchData" JSONB,
    "evidence" JSONB,
    "evidenceHash" TEXT,
    "stages" JSONB,
    "error" TEXT,
    "errorCode" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "platform" TEXT,
    "handle" TEXT,
    "postUrl" TEXT,
    "imageUrl" TEXT,
    "title" TEXT,
    "domain" TEXT,
    "visualSimilarity" DOUBLE PRECISION,
    "faceSimilarity" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION,
    "evidenceStrength" TEXT,
    "matchReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "candidatesAnalysed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Match_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlockchainRecord" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "network" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "transactionHash" TEXT NOT NULL,
    "blockNumber" BIGINT,
    "evidenceHash" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "confirmations" INTEGER,
    "gasUsed" TEXT,
    "status" TEXT NOT NULL DEFAULT 'submitting',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BlockchainRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationEvent" (
    "id" TEXT NOT NULL,
    "verificationId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Verification_inputImageHash_idx" ON "Verification"("inputImageHash");

-- CreateIndex
CREATE INDEX "Verification_evidenceHash_idx" ON "Verification"("evidenceHash");

-- CreateIndex
CREATE INDEX "Verification_createdAt_idx" ON "Verification"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Match_verificationId_key" ON "Match"("verificationId");

-- CreateIndex
CREATE INDEX "Match_platform_idx" ON "Match"("platform");

-- CreateIndex
CREATE UNIQUE INDEX "BlockchainRecord_verificationId_key" ON "BlockchainRecord"("verificationId");

-- CreateIndex
CREATE INDEX "BlockchainRecord_transactionHash_idx" ON "BlockchainRecord"("transactionHash");

-- CreateIndex
CREATE INDEX "BlockchainRecord_evidenceHash_idx" ON "BlockchainRecord"("evidenceHash");

-- CreateIndex
CREATE INDEX "VerificationEvent_verificationId_seq_idx" ON "VerificationEvent"("verificationId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationEvent_verificationId_seq_key" ON "VerificationEvent"("verificationId", "seq");

-- AddForeignKey
ALTER TABLE "Match" ADD CONSTRAINT "Match_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BlockchainRecord" ADD CONSTRAINT "BlockchainRecord_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VerificationEvent" ADD CONSTRAINT "VerificationEvent_verificationId_fkey" FOREIGN KEY ("verificationId") REFERENCES "Verification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

