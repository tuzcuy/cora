import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type AuthUser } from '../../common/decorators/current-user.decorator.js';
import { SearchService } from './search.service.js';

/** /api/v1/search — the command-palette backend (FAZ 2). Authenticated; each
 *  result group is gated by the caller's read permissions inside the service. */
@ApiTags('search')
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get()
  @ApiOperation({
    summary: 'Genel arama: ürün, cari, belge, irsaliye (tenant-filtreli, yetkiye göre)',
  })
  find(@Query('q') q: string, @CurrentUser() user: AuthUser) {
    return this.search.search(q ?? '', user);
  }
}
