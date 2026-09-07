import { Controller, Get } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

// Lightweight liveness probe used by compose/health checks.
@Controller('health')
export class HealthController {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  @Public()
  @Get()
  async status() {
    let db = 'ok';
    try {
      await this.dataSource.query('SELECT 1');
    } catch {
      db = 'error';
    }
    return {
      status: 'ok',
      db,
      uptime: process.uptime(),
      ts: new Date().toISOString(),
    };
  }

  @Public()
  @Get('db')
  async db() {
    try {
      const res = await this.dataSource.query('SELECT 1 as one');
      return { ok: true, result: res };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}
