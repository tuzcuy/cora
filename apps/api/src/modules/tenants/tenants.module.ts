import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('tenants')
@Controller({ path: 'tenants', version: '1' })
export class TenantsController {
  @Get('ping')
  ping() {
    return { module: 'tenants', ok: true };
  }
}

@Module({ controllers: [TenantsController] })
export class TenantsModule {}
