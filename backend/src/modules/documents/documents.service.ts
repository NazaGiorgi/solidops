import { Injectable, NotFoundException, BadRequestException, ForbiddenException, OnModuleInit, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { createHash } from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { tmpdir } from 'os';
import { join, extname, basename } from 'path';
import { existsSync } from 'fs';
import { Document } from '../../entities/document.entity';
import { DocumentVersion } from '../../entities/document-version.entity';
import { Customer } from '../../entities/customer.entity';
import { StorageService } from '../../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, AuditEntityType } from '../../common/enums';
import { AuthenticatedUser } from '../../common/interfaces/authenticated-user.interface';

const execFileAsync = promisify(execFile);

// Document management module. Stores files in MinIO + metadata in Postgres,
// with support for a hierarchical category path, a sensitive flag (credentials)
// and versioning. Sensitive docs are visible to all roles but every view and
// download is audited (the only traceability control given the broad access).
const PREFIX = 'documents';

@Injectable()
export class DocumentsService implements OnModuleInit {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    @InjectRepository(Document) private readonly docs: Repository<Document>,
    @InjectRepository(DocumentVersion) private readonly versions: Repository<DocumentVersion>,
    @InjectRepository(Customer) private readonly customers: Repository<Customer>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  // Create the FTS search_vector column + GIN index + trigger once at bootstrap
  // (synchronize won't emit tsvector or GIN-index DDL reliably).
  async onModuleInit() {
    try {
      await this.dataSource.query(`ALTER TABLE documents ADD COLUMN IF NOT EXISTS search_vector tsvector`);
      await this.dataSource.query(
        `CREATE INDEX IF NOT EXISTS idx_document_search_gin ON documents USING GIN (search_vector)`,
      );
      await this.dataSource.query(`
        DO $$
        BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'documents_search_vector') THEN
            CREATE TRIGGER documents_search_vector
            BEFORE INSERT OR UPDATE OF title, extracted_text ON documents
            FOR EACH ROW EXECUTE FUNCTION tsvector_update_trigger('search_vector', 'pg_catalog.spanish', 'title', 'extracted_text');
          END IF;
        END$$
      `);
      this.logger.log('FTS index/trigger de documentos listos');
    } catch (e) {
      this.logger.warn(`FTS init falló (no bloquea): ${(e as Error).message}`);
    }
  }

  private hash(buffer: Buffer): string {
    return createHash('sha256').update(buffer).digest('hex');
  }

  // Multer decodes multipart filenames as latin1, so UTF-8 names with accents
  // arrive mojibaked ("gestión" -> "gestiÃ³n"). Recover the real UTF-8 name by
  // re-decoding latin1 -> utf8 ONLY when the original actually contains latin1
  // high characters (i.e. it's a mojibake string); pure UTF-8 names are kept.
  private fixName(name: string): string {
    if (!name) return name;
    if (!/[\u00C0-\u00FF\u0080-\u009F]/.test(name)) return name;
    const converted = Buffer.from(name, 'latin1').toString('utf8');
    if (converted.includes('\uFFFD')) return name;
    return converted;
  }

  private async nextVersionNumber(documentId: string): Promise<number> {
    const rows = await this.versions.find({ where: { documentId }, order: { versionNumber: 'DESC' }, take: 1 });
    return (rows[0]?.versionNumber ?? 0) + 1;
  }

  // Upload a new document (or a new version if it references an existing one).
  async upload(
    file: { buffer: Buffer; originalname: string; mimetype: string; size?: number },
    meta: { title?: string; customerId?: string | null; categoryPath?: string | null; sensitive?: boolean; documentType?: string; source?: string; existingDocumentId?: string | null; note?: string | null; sourcePath?: string | null },
    actor: AuthenticatedUser,
  ): Promise<Document> {
    const originalname = this.fixName(file.originalname || 'archivo');
    const hashed = this.hash(file.buffer);
    const documentType = meta.documentType || 'otro';
    const sensitive = meta.sensitive === true || documentType === 'credenciales';
    const title = meta.title?.trim() || originalname;

    // If uploading as a new version of an existing doc.
    if (meta.existingDocumentId) {
      const doc = await this.docs.findOne({ where: { id: meta.existingDocumentId } });
      if (!doc) throw new NotFoundException('Documento no encontrado');
      const next = await this.nextVersionNumber(doc.id);
      const { key } = await this.storage.putObject(file.buffer, originalname, file.mimetype, PREFIX);
      await this.versions.save(
        this.versions.create({
          documentId: doc.id,
          versionNumber: next,
          storagePath: key,
          rawFilename: originalname,
          mimeType: file.mimetype,
          sizeBytes: file.size ?? file.buffer.length,
          hashSha256: hashed,
          note: meta.note ?? null,
          createdByUserId: actor.id,
        }),
      );
      doc.storagePath = key;
      doc.rawFilename = originalname;
      doc.mimeType = file.mimetype;
      doc.sizeBytes = file.size ?? file.buffer.length;
      doc.hashSha256 = hashed;
      await this.docs.save(doc);
      await this.audit.log({
        user: actor,
        action: AuditAction.UPDATE,
        entityType: AuditEntityType.DOCUMENT,
        entityId: doc.id,
        newValue: { version: next, filename: originalname },
        meta: { action: 'document_new_version' },
      });
      return doc;
    }

    // New document.
    const { key } = await this.storage.putObject(file.buffer, originalname, file.mimetype, PREFIX);
    const doc = this.docs.create({
      customerId: meta.customerId ?? null,
      title,
      categoryPath: meta.categoryPath || null,
      storagePath: key,
      rawFilename: originalname,
      mimeType: file.mimetype,
      sizeBytes: file.size ?? file.buffer.length,
      hashSha256: hashed,
      source: meta.source || 'upload',
      sourcePath: meta.sourcePath ?? null,
      status: 'vigente',
      sensitive,
      documentType,
    });
    const saved = await this.docs.save(doc);
    await this.versions.save(
      this.versions.create({
        documentId: saved.id,
        versionNumber: 1,
        storagePath: key,
        rawFilename: originalname,
        mimeType: file.mimetype,
        sizeBytes: file.size ?? file.buffer.length,
        hashSha256: hashed,
        note: meta.note ?? null,
        createdByUserId: actor.id,
      }),
    );
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.DOCUMENT,
      entityId: saved.id,
      newValue: { title: saved.title, customerId: saved.customerId, sensitive: saved.sensitive, documentType: saved.documentType },
      meta: { action: 'document_uploaded' },
    });
    return saved;
  }

  // List documents, optionally filtered by customer or a free-text search.
  // Search combines PostgreSQL FTS (on search_vector) with a fallback ILIKE on
  // title/filename so partial matches still surface even without indexing.
  async list(params: { customerId?: string; search?: string }): Promise<Document[]> {
    const qb = this.docs.createQueryBuilder('d');
    if (params.customerId) qb.andWhere('d.customer_id = :cid', { cid: params.customerId });
    if (params.search) {
      qb.andWhere(
        `(d.search_vector @@ websearch_to_tsquery('spanish', :q) OR d.title ILIKE :ilike OR d.raw_filename ILIKE :ilike)`,
        { q: params.search, ilike: `%${params.search}%` },
      );
    }
    return qb.orderBy('d.updatedAt', 'DESC').getMany();
  }

  // Tree: group documents by customer (or "general" bucket) then category path.
  async tree(): Promise<{ customers: Array<{ id: string | null; name: string; docs: Document[] }> }> {
    const docs = await this.docs.createQueryBuilder('d').orderBy('d.title', 'ASC').getMany();
    const customers = await this.customers.find();
    const nameById = new Map(customers.map((c) => [c.id, c.name]));

    const groups = new Map<string | null, Document[]>();
    for (const d of docs) {
      const key = d.customerId ?? null;
      const arr = groups.get(key) ?? [];
      arr.push(d);
      groups.set(key, arr);
    }

    const result: Array<{ id: string | null; name: string; docs: Document[] }> = [];
    for (const [id, list] of groups.entries()) {
      result.push({ id, name: id ? nameById.get(id) ?? 'Cliente' : 'Recursos generales', docs: list });
    }
    // General (no customer) first so it's always visible, then by name.
    result.sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
    return { customers: result };
  }

  // Download: returns a presigned URL. Audits every download of a sensitive doc.
  async getDownloadUrl(id: string, actor: AuthenticatedUser): Promise<{ url: string; filename: string; sensitive: boolean }> {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc || !doc.storagePath) throw new NotFoundException('Documento no encontrado');
    const url = await this.storage.getPresignedUrl(doc.storagePath, 3600);
    if (doc.sensitive) {
      await this.audit.log({
        user: actor,
        action: AuditAction.DOWNLOAD,
        entityType: AuditEntityType.DOCUMENT,
        entityId: doc.id,
        meta: { filename: doc.rawFilename, sensitive: true, action: 'document_downloaded' },
      });
    }
    return { url, filename: doc.rawFilename || doc.title, sensitive: doc.sensitive };
  }

  // Descarga servida por el BACKEND (no un presigned a un host interno de MinIO).
  // Lee el buffer de MinIO y devuelve los bytes junto a filename/mimeType, para
  // que el controller responda con Content-Disposition: attachment. Esto hace que
  // "descargar" funcione desde el navegador sin depender de que el host interno
  // de MinIO sea alcanzable (bug previo: el presigned apuntaba a http://minio:9000).
  async getDownloadFile(id: string, actor: AuthenticatedUser): Promise<{ buffer: Buffer; mime: string; filename: string; sensitive: boolean }> {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc || !doc.storagePath) throw new NotFoundException('Documento no encontrado');
    const buffer = await this.storage.getObject(doc.storagePath);
    if (doc.sensitive) {
      await this.audit.log({
        user: actor,
        action: AuditAction.DOWNLOAD,
        entityType: AuditEntityType.DOCUMENT,
        entityId: doc.id,
        meta: { filename: doc.rawFilename, sensitive: true, action: 'document_downloaded' },
      });
    }
    return { buffer, mime: doc.mimeType || 'application/octet-stream', filename: doc.rawFilename || doc.title, sensitive: doc.sensitive };
  }

  // View: records access for sensitive docs (called by the UI on open/preview).
  async recordView(id: string, actor: AuthenticatedUser): Promise<void> {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    if (doc.sensitive) {
      await this.audit.log({
        user: actor,
        action: AuditAction.VIEW,
        entityType: AuditEntityType.DOCUMENT,
        entityId: doc.id,
        meta: { filename: doc.rawFilename, sensitive: true, action: 'document_viewed' },
      });
    }
  }

  async listVersions(id: string): Promise<DocumentVersion[]> {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    return this.versions.find({ where: { documentId: id }, order: { versionNumber: 'DESC' } });
  }

  async updateMeta(id: string, dto: { title?: string; categoryPath?: string | null; sensitive?: boolean; documentType?: string }, actor: AuthenticatedUser) {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    if (dto.title !== undefined) doc.title = dto.title;
    if (dto.categoryPath !== undefined) doc.categoryPath = dto.categoryPath;
    if (dto.documentType !== undefined) { doc.documentType = dto.documentType; if (dto.documentType === 'credenciales') doc.sensitive = true; }
    if (dto.sensitive !== undefined) doc.sensitive = dto.sensitive;
    const saved = await this.docs.save(doc);
    await this.audit.log({
      user: actor,
      action: AuditAction.UPDATE,
      entityType: AuditEntityType.DOCUMENT,
      entityId: saved.id,
      newValue: { title: saved.title, sensitive: saved.sensitive, documentType: saved.documentType },
      meta: { action: 'document_meta_updated' },
    });
    return saved;
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const doc = await this.docs.findOne({ where: { id } });
    if (!doc) throw new NotFoundException('Documento no encontrado');
    if (doc.storagePath) await this.storage.deleteObject(doc.storagePath);
    await this.audit.log({
      user: actor,
      action: AuditAction.DELETE,
      entityType: AuditEntityType.DOCUMENT,
      entityId: id,
      meta: { filename: doc.rawFilename, action: 'document_deleted' },
    });
    await this.docs.remove(doc);
    return { ok: true };
  }

  // Tipo simple: nombre de archivo actual del documento (o de una versión).
  async documentFilename(docId: string, versionId?: string): Promise<string | null> {
    const doc = await this.docs.findOne({ where: { id: docId } });
    if (!doc) return null;
    if (versionId) {
      const v = await this.versions.findOne({ where: { id: versionId } });
      if (v?.rawFilename) return v.rawFilename;
    }
    return doc.rawFilename || doc.title;
  }

  // --- Tipo de archivo / vista previa ---------------------------------------
  // Determina si un documento se puede previsualizar en el navegador y cómo.
  //  - 'inline'    -> se sirve tal cual (PDF, imágenes) con Content-Disposition inline.
  //  - 'office'    -> requiere conversión a PDF (Word/Excel/PowerPoint) con soffice.
  //  - null        -> no hay vista previa (zip, eddx, etc.) → descarga.
  previewKind(filename: string | null | undefined, mimeType?: string | null): { kind: 'inline' | 'office' | null; mime: string } {
    const ext = (filename || '').split('.').pop()?.toLowerCase() || '';
    const likely = (mimeType || '').toLowerCase();
    if (ext === 'pdf' || likely.includes('pdf')) return { kind: 'inline', mime: 'application/pdf' };
    if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)) {
      const map: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml' };
      return { kind: 'inline', mime: map[ext] || 'image/png' };
    }
    if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'odt', 'ods', 'odp', 'rtf', 'txt'].includes(ext)) {
      return { kind: 'office', mime: 'application/pdf' }; // se convierte a PDF
    }
    return { kind: null, mime: likely || 'application/octet-stream' };
  }

  // Devuelve el PDF previsualizable (existente en MinIO o convirtiéndolo on demand).
  // `versionId` es opcional: si viene, se usa/preview cachea para esa versión.
  // NUNCA consulta la carpeta de red: todo sale de MinIO.
  async getPreview(
    docId: string,
    versionId?: string,
  ): Promise<{ buffer: Buffer; mime: string; kind: 'inline' | 'office' }> {
    const doc = await this.docs.findOne({ where: { id: docId } });
    if (!doc || !doc.storagePath) throw new NotFoundException('Documento no encontrado');

    // Determinar la versión activa (la más reciente)
    let storagePath = doc.storagePath;
    let filename = doc.rawFilename || doc.title;
    if (versionId) {
      const v = await this.versions.findOne({ where: { id: versionId } });
      if (v) { storagePath = v.storagePath; filename = v.rawFilename || filename; }
    }

    const { kind, mime } = this.previewKind(filename, doc.mimeType);
    if (!kind) throw new Error('NO_PREVIEW'); // sin vista previa

    // 1) inline (PDF/imagen): sirve el objeto tal cual.
    if (kind === 'inline') {
      const buffer = await this.storage.getObject(storagePath);
      return { buffer, mime, kind: 'inline' };
    }

    // 2) office: buscar PDF cacheado por versión en MinIO; si no, convertir.
    const base = storagePath.split('.').slice(0, -1).join('.');
    const cacheKey = `${base}.preview.pdf`;
    const cached = await this.storage.statObject(cacheKey);
    if (cached && cached.size > 0) {
      return { buffer: await this.storage.getObject(cacheKey), mime: 'application/pdf', kind: 'office' };
    }

    // Convertir office -> pdf usando soffice en un temp dir y subir a MinIO.
    const pdfBuffer = await this.convertToPdf(storagePath, filename);
    if (pdfBuffer) {
      await this.storage.putObjectAs(cacheKey, pdfBuffer, 'application/pdf');
      return { buffer: pdfBuffer, mime: 'application/pdf', kind: 'office' };
    }
    // Fallo de conversión: sin preview (la UI ofrecerá descarga).
    throw new Error('CONVERT_FAILED');
  }

  // Convierte un documento ofimático a PDF llamando al servicio lo-converter
  // (LibreOffice headless en un contenedor aparte). Devuelve el Buffer del PDF o
  // null si falla. La conversión es on-demand y luego se cachea en MinIO.
  // IMPORTANTE: la llamada tiene un TIMEOUT. Si LibreOffice se cuelga (algún .docx
  // con contenido especial), no podemos dejar el request esperando para siempre:
  // se aborta y devuelve null -> getPreview lanza CONVERT_FAILED (422).
  private async convertToPdf(storagePath: string, filename: string): Promise<Buffer | null> {
    const timeoutMs = parseInt(process.env.LO_CONVERTER_TIMEOUT_MS || '60000', 10);
    try {
      const url = process.env.LO_CONVERTER_URL || 'http://lo-converter:8000';
      const buffer = await this.storage.getObject(storagePath);
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)]);
      form.append('file', blob, filename);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(`${url}/convert`, { method: 'POST', body: form, signal: controller.signal });
        if (!res.ok) {
          this.logger.warn(`lo-converter respondió ${res.status}`);
          return null;
        }
        const arrayBuf = await res.arrayBuffer();
        return Buffer.from(arrayBuf);
      } finally {
        clearTimeout(timer);
      }
    } catch (e) {
      this.logger.warn(`Conversión LibreOffice falló: ${(e as Error).message}`);
      return null;
    }
  }

  // Crea una "carpeta" vacía (una categoría sin documentos todavía) solo para
  // reservar el lugar en el explorador. No sube ningún archivo a MinIO: guarda un
  // Document marcado con documentType='carpeta' cuyo categoryPath es la ruta de la
  // carpeta. El explorer lo muestra como carpeta clickeable (no como archivo).
  async createFolder(meta: {
    title?: string | null;
    customerId?: string | null;
    categoryPath?: string | null;
  }, actor: AuthenticatedUser): Promise<Document> {
    // El nombre de la carpeta es el último tramo del categoryPath (o el title).
    const folderName = meta.title?.trim() || (meta.categoryPath || '').split('/').filter(Boolean).slice(-1)[0] || 'Nueva carpeta';
    const doc = this.docs.create({
      customerId: meta.customerId ?? null,
      title: folderName,
      categoryPath: meta.categoryPath || null,
      storagePath: '',              // sin archivo: solo marca de carpeta
      rawFilename: null,
      mimeType: null,
      sizeBytes: 0,
      hashSha256: null,
      source: meta.customerId ? 'upload' : 'migracion',
      sourcePath: null,
      status: 'carpeta',
      sensitive: false,
      documentType: 'carpeta',
    });
    const saved = await this.docs.save(doc);
    await this.audit.log({
      user: actor,
      action: AuditAction.CREATE,
      entityType: AuditEntityType.DOCUMENT,
      entityId: saved.id,
      newValue: { folder: folderName, categoryPath: meta.categoryPath || null },
      meta: { action: 'create_folder' },
    });
    return saved;
  }

  // Devuelve la vista navegable por carpetas (explorador). Agrupa los documentos
  // por cliente y luego por su `category_path` (jerarquía de carpetas). El nombre
  // del archivo es el último segmento del category_path; los tramos anteriores son
  // las carpetas. El contenedor NUNCA toca la carpeta de red.
  async explorerTree(rootCustomerId?: string | null): Promise<Array<{ id: string | null; name: string; children: Array<Record<string, unknown>> }>> {
    const qb = this.docs.createQueryBuilder('d').orderBy('d.title', 'ASC');
    if (rootCustomerId !== undefined) {
      if (rootCustomerId === null) qb.andWhere('d.customer_id IS NULL');
      else qb.andWhere('d.customer_id = :cid', { cid: rootCustomerId });
    }
    const docs = await qb.getMany();
    const customers = await this.customers.find();
    const nameById = new Map(customers.map((c) => [c.id, c.name]));

    // Agrupar por cliente, luego por cadena de carpetas.
    const byCustomer = new Map<string | null, Map<string, Document[]>>();
    for (const d of docs) {
      const ck = d.customerId ?? null;
      let dir = byCustomer.get(ck);
      if (!dir) { dir = new Map<string, Document[]>(); byCustomer.set(ck, dir); }
      const full = d.categoryPath || '';
      const parts = full.split('/').filter(Boolean);
      // Una "carpeta" marcada (documentType='carpeta') es una categoría vacía:
      // se registra como carpeta del nivel del categoryPath, no como archivo.
      if (d.documentType === 'carpeta') {
        const folderKey = parts.length ? parts.join('/') : '';
        const arr = dir.get(folderKey) ?? [];
        arr.push(d);
        dir.set(folderKey, arr);
        continue;
      }
      // carpetas = todos los tramos del category_path excepto el último (que es el archivo)
      const folderKey = parts.length > 1 ? parts.slice(0, -1).join('/') : '';
      const arr = dir.get(folderKey) ?? [];
      arr.push(d);
      dir.set(folderKey, arr);
    }

    const result: Array<{ id: string | null; name: string; children: Array<Record<string, unknown>> }> = [];
    for (const [cid, dirs] of byCustomer.entries()) {
      const custName = cid ? nameById.get(cid) ?? 'Cliente' : 'Recursos generales';
      const folders = Array.from(dirs.entries())
        .map(([folderKey, list]) => {
          // Para una carpeta marcada, list vacío (no hay archivos), pero el doc
          // guarda la "carpeta" en sí. Lo separamos como carpeta pura.
          const isFolderOnly = list.every((d) => d.documentType === 'carpeta');
          return { folder: folderKey, list: isFolderOnly ? [] : list.filter((d) => d.documentType !== 'carpeta') };
        })
        .filter((f) => f.folder !== '')
        .sort((a, b) => a.folder.localeCompare(b.folder));
      result.push({ id: cid, name: custName, children: folders as unknown as Array<Record<string, unknown>> });
    }
    result.sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : a.name.localeCompare(b.name)));
    return result;
  }
}
