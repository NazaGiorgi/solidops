import { Column, Entity, Index, JoinColumn, ManyToOne, OneToMany } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Customer } from './customer.entity';
import { Asset } from './asset.entity';
import { Site } from './site.entity';
import { DocumentVersion } from './document-version.entity';

// Document entity — used by the email-routing `document` destination AND the
// document-management module (migrated network folders -> MinIO + Postgres).
// Supports hierarchical category path, sensitive/credentials flag, and versioning.
@Entity('documents')
export class Document extends BaseEntity {
  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, { nullable: true })
  @JoinColumn({ name: 'customer_id' })
  customer: Customer | null;

  @Index()
  @Column({ name: 'asset_id', type: 'uuid', nullable: true })
  assetId: string | null;

  @ManyToOne(() => Asset, { nullable: true })
  @JoinColumn({ name: 'asset_id' })
  asset: Asset | null;

  @Index()
  @Column({ name: 'site_id', type: 'uuid', nullable: true })
  siteId: string | null;

  @ManyToOne(() => Site, { nullable: true })
  @JoinColumn({ name: 'site_id' })
  site: Site | null;

  @Column({ type: 'varchar', length: 255 })
  title: string;

  // Hierarchical category path preserved from the source tree, e.g.
  // "Hosting y web" or "Infraestructura de red/Firewalls". Empty = no area.
  @Column({ name: 'category_path', type: 'varchar', length: 500, nullable: true })
  categoryPath: string | null;

  // MinIO object path/key of the CURRENT (latest) file. Null until uploaded.
  @Column({ name: 'storage_path', type: 'varchar', length: 600, nullable: true })
  storagePath: string | null;

  // Original file name as it exists in source (for display/download).
  @Column({ name: 'raw_filename', type: 'varchar', length: 255, nullable: true })
  rawFilename: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: number;

  // SHA-256 of the file content — used for duplicate detection & sync.
  @Column({ name: 'hash_sha256', type: 'varchar', length: 64, nullable: true })
  hashSha256: string | null;

  // Origin: 'email' (routed) | 'upload' (manual) | 'migracion' (network import).
  @Column({ name: 'source', type: 'varchar', length: 20, default: 'email' })
  source: string;

  // Full path in the source system (network folder) for migrated docs.
  @Column({ name: 'source_path', type: 'varchar', length: 600, nullable: true })
  sourcePath: string | null;

  // status: vigente | obsoleto | sin_clasificar
  @Column({ type: 'varchar', length: 24, default: 'sin_clasificar' })
  status: string;

  // Distinguishes credentials/access data from generic manuals/diagrams.
  // Sensitive docs are visible to all roles but every view/download is audited.
  @Column({ name: 'sensitive', type: 'boolean', default: false })
  sensitive: boolean;

  // Document type: 'manual' | 'diagrama' | 'credenciales' | 'otro'.
  @Column({ name: 'document_type', type: 'varchar', length: 20, default: 'otro' })
  documentType: string;

  // Extracted text for PostgreSQL Full Text Search (kept in sync on import).
  @Column({ name: 'extracted_text', type: 'text', nullable: true })
  extractedText: string | null;

  // Original email body/text for email-sourced documents.
  @Column({ type: 'text', nullable: true })
  body: string | null;

  // FTS search vector (tsvector) — populated via SQL trigger on save. The column
  // and GIN index are created once at bootstrap (see documents.service onModuleInit),
  // not by synchronize, to avoid duplicate-index failures.
  @Column({ name: 'search_vector', type: 'tsvector', nullable: true, select: false })
  searchVector: unknown;

  @OneToMany(() => DocumentVersion, (v) => v.document)
  versions: DocumentVersion[];
}
