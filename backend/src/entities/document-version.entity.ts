import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { Document } from './document.entity';

// A version of a Document. Each re-upload of an existing document creates a new
// version rather than overwriting the file. The Document.storage_path always
// points to the LATEST version's object; older versions remain downloadable.
@Entity('document_versions')
export class DocumentVersion extends BaseEntity {
  @Index()
  @Column({ name: 'document_id', type: 'uuid' })
  documentId: string;

  @ManyToOne(() => Document, (d) => d.versions, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'document_id' })
  document: Document;

  // Monotonic version number starting at 1.
  @Column({ name: 'version_number', type: 'int' })
  versionNumber: number;

  @Column({ name: 'storage_path', type: 'varchar', length: 600 })
  storagePath: string;

  @Column({ name: 'raw_filename', type: 'varchar', length: 255, nullable: true })
  rawFilename: string | null;

  @Column({ name: 'mime_type', type: 'varchar', length: 120, nullable: true })
  mimeType: string | null;

  @Column({ name: 'size_bytes', type: 'bigint', default: 0 })
  sizeBytes: number;

  @Column({ name: 'hash_sha256', type: 'varchar', length: 64, nullable: true })
  hashSha256: string | null;

  // Optional note when creating this version (e.g. "updated password").
  @Column({ type: 'varchar', length: 500, nullable: true })
  note: string | null;

  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId: string | null;
}
