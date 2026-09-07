import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseInterceptors, Res, Header } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { IsBoolean, IsOptional, IsString } from 'class-validator';
import { DocumentsService } from './documents.service';
import { Permissions } from '../../common/guards/permissions-key.decorator';
import { PERMISSIONS } from '../../common/auth/permissions';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

class UploadDocDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() customerId?: string | null;
  @IsOptional() @IsString() categoryPath?: string | null;
  @IsOptional() @IsBoolean() sensitive?: boolean;
  @IsOptional() @IsString() documentType?: string;
  @IsOptional() @IsString() existingDocumentId?: string | null;
  @IsOptional() @IsString() note?: string | null;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsString() sourcePath?: string | null;
}

class UpdateDocDto {
  @IsOptional() @IsString() title?: string;
  @IsOptional() @IsString() categoryPath?: string | null;
  @IsOptional() @IsBoolean() sensitive?: boolean;
  @IsOptional() @IsString() documentType?: string;
}

// Document management. Access handled via PERMISSIONS / shared row-level scope;
// sensitive docs are visible to all roles but every view/download is audited.
@Controller('documents')
export class DocumentsController {
  constructor(private readonly docs: DocumentsService) {}

  @Get('tree')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  tree() {
    return this.docs.tree();
  }

  @Get()
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  list(@Query('customerId') customerId?: string, @Query('search') search?: string) {
    return this.docs.list({ customerId, search });
  }

  // Upload a file. Uses FormData: field 'file' + optional metadata fields.
  @Post('upload')
  @Permissions(PERMISSIONS.DOCUMENTS_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  upload(@UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocDto, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new Error('Archivo requerido');
    return this.docs.upload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size },
      { title: dto.title, customerId: dto.customerId, categoryPath: dto.categoryPath, sensitive: dto.sensitive, documentType: dto.documentType, source: dto.source || 'upload', existingDocumentId: dto.existingDocumentId, note: dto.note, sourcePath: dto.sourcePath },
      user,
    );
  }

  // Crea una carpeta vacía (categoría sin contenido) para organizar documentos.
  // No sube archivos: solo reserva el lugar en el explorador.
  @Post('folder')
  @Permissions(PERMISSIONS.DOCUMENTS_WRITE)
  createFolder(@Body() dto: UploadDocDto, @CurrentUser() user: AuthenticatedUser) {
    return this.docs.createFolder(
      { title: dto.title, customerId: dto.customerId, categoryPath: dto.categoryPath },
      user,
    );
  }

  // New version of an existing document (upload referencing existingDocumentId).
  @Post(':id/versions')
  @Permissions(PERMISSIONS.DOCUMENTS_WRITE)
  @UseInterceptors(FileInterceptor('file'))
  newVersion(@Param('id') id: string, @UploadedFile() file: Express.Multer.File, @Body() dto: UploadDocDto, @CurrentUser() user: AuthenticatedUser) {
    if (!file) throw new Error('Archivo requerido');
    return this.docs.upload(
      { buffer: file.buffer, originalname: file.originalname, mimetype: file.mimetype, size: file.size },
      { title: dto.title, existingDocumentId: id, note: dto.note },
      user,
    );
  }

  @Get(':id/versions')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  versions(@Param('id') id: string) {
    return this.docs.listVersions(id);
  }

  @Get(':id/download')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  async download(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser, @Res() res: Response) {
    const { buffer, mime, filename } = await this.docs.getDownloadFile(id, user);
    res.setHeader('Content-Type', mime);
    // attachment: fuerza la descarga en el cliente. El archivo se sirve por el
    // backend (lee de MinIO) para que funcione sin acceso al host interno.
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename || 'documento')}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  }

  // Vista previa en el navegador (inline). PDF/imágenes se sirven tal cual;
  // Word/Excel/PowerPoint se convierten a PDF on-demand (cacheado por versión).
  // - Si el archivo no tiene vista previa (zip, eddx): 422 con mensaje claro.
  // - Si la conversión falla: 422 con mensaje claro (la UI ofrece descarga).
  @Get(':id/preview')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  async preview(@Param('id') id: string, @Query('versionId') versionId: string | undefined, @Res() res: Response) {
    try {
      const { buffer, mime, kind } = await this.docs.getPreview(id, versionId);
      const filename = (await this.docs.documentFilename(id, versionId));
      res.setHeader('Content-Type', mime);
      res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename || 'preview')}"`);
      res.setHeader('X-Preview-Kind', kind);
      res.send(buffer);
    } catch (e) {
      const msg = (e as Error).message;
      const status = msg === 'NO_PREVIEW' || msg === 'CONVERT_FAILED' ? 422 : 404;
      res.status(status).json({ message: msg === 'CONVERT_FAILED' ? 'No se pudo previsualizar este archivo' : msg === 'NO_PREVIEW' ? 'Este archivo no tiene vista previa disponible' : 'Documento no encontrado', ok: false });
    }
  }

  // Navegación por carpetas tipo Explorador de Windows (agrupada por customer +
  // category_path). Devuelve clientes -> carpetas -> documentos.
  @Get('explorer/tree')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  explorerTree(@Query('customerId') customerId?: string) {
    return this.docs.explorerTree(customerId === 'null' ? null : customerId || undefined);
  }

  @Post(':id/view')
  @Permissions(PERMISSIONS.DOCUMENTS_READ)
  view(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.docs.recordView(id, user);
  }

  @Patch(':id')
  @Permissions(PERMISSIONS.DOCUMENTS_WRITE)
  update(@Param('id') id: string, @Body() dto: UpdateDocDto, @CurrentUser() user: AuthenticatedUser) {
    return this.docs.updateMeta(id, dto, user);
  }

  @Delete(':id')
  @Permissions(PERMISSIONS.DOCUMENTS_WRITE)
  remove(@Param('id') id: string, @CurrentUser() user: AuthenticatedUser) {
    return this.docs.remove(id, user);
  }
}
