-- Sequence kinds for stock counts and customer returns (P05).
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'STOCK_COUNT';
ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'RETURN';
