import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import { RequirePermission } from '../../common/decorators/permissions.decorator.js';
import { CrudDeleteQuerySchema, type CrudDeleteQuery } from '../../common/crud/crud-query.dto.js';
import { StockService } from './stock.service.js';
import {
  AdjustSchema,
  CountQuerySchema,
  CreateCountSchema,
  CreateReceiptSchema,
  LevelQuerySchema,
  MovementQuerySchema,
  ReceiptQuerySchema,
  TransferSchema,
  UpdateCountSchema,
  UpdateReceiptSchema,
  type AdjustDto,
  type CountQuery,
  type CreateCountDto,
  type CreateReceiptDto,
  type LevelQuery,
  type MovementQuery,
  type ReceiptQuery,
  type TransferDto,
  type UpdateCountDto,
  type UpdateReceiptDto,
} from './dto/stock.dto.js';

/** /api/v1/stock — ledger, levels, goods receipts, adjustments, transfers, counts (P05). */
@ApiTags('stock')
@Controller({ path: 'stock', version: '1' })
export class StockController {
  constructor(private readonly stock: StockService) {}

  @Get('movements')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Stok hareket defteri (filtreli)' })
  movements(@Query(new ZodValidationPipe(MovementQuerySchema)) q: MovementQuery) {
    return this.stock.movements(q);
  }

  @Get('levels')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Depo bazında stok durumu' })
  levels(@Query(new ZodValidationPipe(LevelQuerySchema)) q: LevelQuery) {
    return this.stock.levels(q);
  }

  /* ── receipts ── */

  @Get('receipts')
  @RequirePermission('stock.read')
  @ApiOperation({ summary: 'Giriş fişi listesi' })
  receipts(@Query(new ZodValidationPipe(ReceiptQuerySchema)) q: ReceiptQuery) {
    return this.stock.receipts(q);
  }

  @Get('receipts/:id')
  @RequirePermission('stock.read')
  receipt(@Param('id') id: string) {
    return this.stock.receipt(id);
  }

  @Post('receipts')
  @RequirePermission('stock.receive')
  @ApiOperation({ summary: 'Giriş fişi oluştur (taslak)' })
  createReceipt(@Body(new ZodValidationPipe(CreateReceiptSchema)) dto: CreateReceiptDto) {
    return this.stock.createReceipt(dto);
  }

  @Patch('receipts/:id')
  @RequirePermission('stock.receive')
  updateReceipt(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateReceiptSchema)) dto: UpdateReceiptDto) {
    return this.stock.updateReceipt(id, dto);
  }

  @Delete('receipts/:id')
  @RequirePermission('stock.receive')
  deleteReceipt(@Param('id') id: string, @Query(new ZodValidationPipe(CrudDeleteQuerySchema)) q: CrudDeleteQuery) {
    return this.stock.deleteReceipt(id, q.version);
  }

  @Post('receipts/:id/post')
  @RequirePermission('stock.receive')
  @ApiOperation({ summary: 'Fişi işle: RECEIPT hareketleri + stok artışı + ortalama maliyet' })
  postReceipt(@Param('id') id: string) {
    return this.stock.postReceipt(id);
  }

  /* ── adjustment / transfer ── */

  @Post('adjust')
  @RequirePermission('stock.adjust')
  @ApiOperation({ summary: 'Stok düzeltme (sebep zorunlu)' })
  adjust(@Body(new ZodValidationPipe(AdjustSchema)) dto: AdjustDto) {
    return this.stock.adjust(dto);
  }

  @Post('transfer')
  @RequirePermission('stock.transfer')
  @ApiOperation({ summary: 'Depolar arası transfer (çıkış + giriş tek transaction)' })
  transfer(@Body(new ZodValidationPipe(TransferSchema)) dto: TransferDto) {
    return this.stock.transfer(dto);
  }

  /* ── counting ── */

  @Get('counts')
  @RequirePermission('stock.read')
  counts(@Query(new ZodValidationPipe(CountQuerySchema)) q: CountQuery) {
    return this.stock.counts(q);
  }

  @Get('counts/:id')
  @RequirePermission('stock.read')
  count(@Param('id') id: string) {
    return this.stock.count(id);
  }

  @Post('counts')
  @RequirePermission('stock.count')
  @ApiOperation({ summary: 'Sayım fişi aç (sistem miktarını dondurur)' })
  createCount(@Body(new ZodValidationPipe(CreateCountSchema)) dto: CreateCountDto) {
    return this.stock.createCount(dto);
  }

  @Patch('counts/:id')
  @RequirePermission('stock.count')
  updateCount(@Param('id') id: string, @Body(new ZodValidationPipe(UpdateCountSchema)) dto: UpdateCountDto) {
    return this.stock.updateCount(id, dto);
  }

  @Post('counts/:id/post')
  @RequirePermission('stock.count')
  @ApiOperation({ summary: 'Sayımı işle: yalnız farklar için COUNT hareketi' })
  postCount(@Param('id') id: string) {
    return this.stock.postCount(id);
  }
}
