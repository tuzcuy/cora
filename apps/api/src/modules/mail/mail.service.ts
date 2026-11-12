import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import nodemailer, { type Transporter } from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { PdfService } from '../documents/pdf.service.js';
import { SalesDocumentsService } from '../sales/sales-documents.service.js';

export interface SendDocumentDto {
  to: string;
  cc?: string;
  subject?: string;
  body?: string;
  attachPdf?: boolean;
  /** Move a DRAFT quote to SENT after a successful send. */
  markSent?: boolean;
}

/**
 * Outgoing mail (P06). SMTP settings come from the environment; when they are
 * missing the message is still recorded in EmailLog with status QUEUED and the
 * caller is told so — a demo without a mail server must not look like a silent
 * success.
 */
@Injectable()
export class MailService {
  private readonly log = new Logger(MailService.name);
  private transporter: Transporter | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly sales: SalesDocumentsService,
  ) {}

  private get configured() {
    return !!process.env.SMTP_HOST;
  }

  private get from() {
    return process.env.SMTP_FROM ?? process.env.SMTP_USER ?? 'cora@corantsoft.com';
  }

  private transport(): Transporter | null {
    if (!this.configured) return null;
    if (!this.transporter) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT ?? 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
          : undefined,
        // Fail fast: a misconfigured SMTP host must never hang the API request
        // (the API is behind Render — a stuck socket ties up a web dyno).
        connectionTimeout: 10_000,
        greetingTimeout: 10_000,
        socketTimeout: 20_000,
      });
    }
    return this.transporter;
  }

  async log_(params: {
    documentId?: string;
    to: string;
    subject: string;
    status: 'QUEUED' | 'SENT' | 'FAILED';
    error?: string;
  }) {
    return this.prisma.db.emailLog.create({
      data: {
        documentId: params.documentId ?? null,
        to: params.to,
        subject: params.subject,
        status: params.status,
        error: params.error ?? null,
        sentAt: params.status === 'SENT' ? new Date() : null,
      } as never,
    });
  }

  /** Mail history for one document (or the whole tenant when no id is given). */
  async history(documentId?: string) {
    const items = await this.prisma.db.emailLog.findMany({
      where: documentId ? { documentId } : {},
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        to: true,
        subject: true,
        status: true,
        error: true,
        sentAt: true,
        createdAt: true,
        documentId: true,
      },
    });
    return { items, smtpConfigured: this.configured };
  }

  /**
   * Verify the SMTP settings and send a plain test message. Lets an admin
   * confirm a newly configured provider (Brevo/Resend/…) actually delivers,
   * without needing a real document. Returns a structured result, never throws.
   */
  async sendTest(to: string) {
    const transporter = this.transport();
    if (!transporter) {
      return {
        ok: false,
        smtpConfigured: false,
        message:
          'SMTP tanımlı değil: sunucuda SMTP_HOST / SMTP_PORT / SMTP_USER / SMTP_PASS / SMTP_SECURE / SMTP_FROM ayarlayın.',
      };
    }
    try {
      await transporter.verify();
    } catch (e) {
      this.log.error(`SMTP doğrulanamadı: ${(e as Error).message}`);
      return {
        ok: false,
        smtpConfigured: true,
        message: `SMTP bağlantısı kurulamadı: ${(e as Error).message}`,
      };
    }
    try {
      const info = await transporter.sendMail({
        from: this.from,
        to,
        subject: 'Cora — SMTP test',
        text: 'Bu bir Cora SMTP test e-postasıdır. Bu mesajı aldıysanız e-posta gönderimi çalışıyor.',
      });
      this.log.log(`SMTP test gönderildi → ${to} (messageId=${info.messageId})`);
      return {
        ok: true,
        smtpConfigured: true,
        message: `${to} adresine test e-postası gönderildi.`,
        messageId: info.messageId,
      };
    } catch (e) {
      this.log.error(`SMTP test gönderilemedi: ${(e as Error).message}`);
      return { ok: false, smtpConfigured: true, message: `Gönderilemedi: ${(e as Error).message}` };
    }
  }

  /** Send a quote/order as PDF and (optionally) move a draft quote to SENT. */
  async sendDocument(documentId: string, dto: SendDocumentDto) {
    const doc = await this.prisma.db.salesDocument.findFirst({
      where: { id: documentId },
      include: {
        partner: { select: { name: true, email: true } },
        salesRep: { select: { fullName: true, email: true } },
      },
    });
    if (!doc) throw new NotFoundException('Belge bulunamadı');

    const to = dto.to?.trim() || doc.partner.email || '';
    const subject =
      dto.subject?.trim() ||
      `${doc.partner.name} — ${doc.type === 'QUOTE' ? 'Teklifimiz' : 'Sipariş formu'} ${doc.number}`;
    const body =
      dto.body?.trim() ||
      [
        `Sayın ${doc.partner.name},`,
        '',
        `${doc.number} numaralı ${doc.type === 'QUOTE' ? 'teklifimizi' : 'sipariş formunu'} ekte bulabilirsiniz.`,
        doc.validUntil
          ? `Teklif ${new Date(doc.validUntil).toLocaleDateString('tr-TR')} tarihine kadar geçerlidir.`
          : '',
        '',
        'İyi çalışmalar dileriz.',
        doc.salesRep?.fullName ?? '',
      ]
        .filter(Boolean)
        .join('\n');

    if (!to) {
      const entry = await this.log_({
        documentId,
        to: '(boş)',
        subject,
        status: 'FAILED',
        error: 'Alıcı e-posta adresi yok',
      });
      return {
        ok: false,
        status: 'FAILED' as const,
        message: 'Müşterinin e-posta adresi yok; alıcıyı elle girin.',
        logId: entry.id,
        smtpConfigured: this.configured,
      };
    }

    const attachments =
      dto.attachPdf === false
        ? []
        : [
            await this.pdf
              .salesDocument(documentId)
              .then((p) => ({ filename: p.fileName, content: p.buffer })),
          ];
    const transporter = this.transport();

    if (!transporter) {
      const entry = await this.log_({ documentId, to, subject, status: 'QUEUED' });
      await this.audit.record({
        entity: 'SalesDocument',
        entityId: documentId,
        action: 'update',
        diff: { email: { from: null, to: `${to} (kuyrukta)` } },
      });
      if (dto.markSent !== false && doc.type === 'QUOTE' && doc.status === 'DRAFT') {
        await this.sales.transition(documentId, {
          toStatus: 'SENT',
          note: `E-posta kuyruğa alındı: ${to}`,
        });
      }
      return {
        ok: false,
        status: 'QUEUED' as const,
        message: 'SMTP tanımlı değil: e-posta kuyruğa yazıldı, sunucu ayarlandığında gönderilecek.',
        logId: entry.id,
        smtpConfigured: false,
      };
    }

    try {
      await transporter.sendMail({
        from: this.from,
        to,
        cc: dto.cc || undefined,
        subject,
        text: body,
        attachments,
      });
      const entry = await this.log_({ documentId, to, subject, status: 'SENT' });
      await this.audit.record({
        entity: 'SalesDocument',
        entityId: documentId,
        action: 'update',
        diff: { email: { from: null, to } },
      });
      if (dto.markSent !== false && doc.type === 'QUOTE' && doc.status === 'DRAFT') {
        await this.sales.transition(documentId, {
          toStatus: 'SENT',
          note: `E-posta gönderildi: ${to}`,
        });
      }
      return {
        ok: true,
        status: 'SENT' as const,
        message: `${to} adresine gönderildi.`,
        logId: entry.id,
        smtpConfigured: true,
      };
    } catch (e) {
      this.log.error(`Mail gönderilemedi: ${(e as Error).message}`);
      const entry = await this.log_({
        documentId,
        to,
        subject,
        status: 'FAILED',
        error: (e as Error).message,
      });
      return {
        ok: false,
        status: 'FAILED' as const,
        message: `Gönderilemedi: ${(e as Error).message}`,
        logId: entry.id,
        smtpConfigured: true,
      };
    }
  }
}
