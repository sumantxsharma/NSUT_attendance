import { Router } from 'express';
import { z } from 'zod';
import { can, EXPORT_FORMATS, REPORT_TYPES } from '@nsut/shared';
import { audit } from '../lib/audit';
import { ah, AppError, forbidden } from '../lib/errors';
import { logger } from '../lib/logger';
import { requirePerm } from '../middleware/auth';
import { toCsv, toPdf, toXlsx } from '../services/export';
import { buildReport, reportQuerySchema } from '../services/reports';

export const reportsRouter = Router();

reportsRouter.get(
  '/:type',
  requirePerm('reports.generate'),
  ah(async (req, res) => {
    const type = z.enum(REPORT_TYPES).parse(req.params.type);
    const { format = 'json', ...rest } = z.object({ format: z.enum(EXPORT_FORMATS).optional() }).passthrough().parse(req.query);
    const q = reportQuerySchema.parse(rest);
    if (format !== 'json' && !can(req.auth!.user.role, 'reports.export')) throw forbidden();

    const report = await buildReport(req, type, q);
    if (format === 'json') return res.json(report);

    const stamp = new Date().toISOString().slice(0, 10);
    const filename = `nsut-${type}-report-${stamp}.${format}`;
    let body: Buffer | string;
    try {
      body = format === 'csv' ? toCsv(report) : format === 'xlsx' ? await toXlsx(report) : await toPdf(report);
    } catch (err) {
      logger.error({ err, type, format }, 'report export failed');
      throw new AppError(500, 'REPORT_FAILED', 'Unable to generate report. Please try again.');
    }
    await audit({ action: 'REPORT_EXPORT', entityType: 'report', entityId: type, summary: `Exported ${report.title} (${report.period}) as ${format.toUpperCase()}`, newValue: { filters: report.filters, rows: report.rows.length } }, req);
    const types = { csv: 'text/csv; charset=utf-8', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pdf: 'application/pdf' };
    res.setHeader('Content-Type', types[format]);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Cache-Control', 'no-store');
    res.send(body);
  }),
);
