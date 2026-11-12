import { Controller, Get, Module } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

@ApiTags('users')
@Controller({ path: 'users', version: '1' })
export class UsersController {
  @Get('ping')
  ping() {
    return { module: 'users', ok: true };
  }
}

@Module({ controllers: [UsersController] })
export class UsersModule {}
