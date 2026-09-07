import { Column, Entity, Index, JoinColumn, ManyToOne } from 'typeorm';
import { SoftDeleteEntity } from '../common/entities/soft-delete.entity';
import { Customer } from './customer.entity';
import { ContactPreferredChannel } from '../common/enums';

@Entity('contacts')
export class Contact extends SoftDeleteEntity {
  @Index()
  @Column({ name: 'customer_id', type: 'uuid', nullable: true })
  customerId: string | null;

  @ManyToOne(() => Customer, (customer) => customer.contacts)
  @JoinColumn({ name: 'customer_id' })
  customer: Customer;

  @Column({ type: 'varchar', length: 160 })
  name: string;

  @Index()
  @Column({ type: 'varchar', length: 160, nullable: true })
  email: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  phone: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  whatsapp: string | null;

  @Index()
  @Column({
    name: 'preferred_channel',
    type: 'varchar',
    length: 20,
    default: ContactPreferredChannel.EMAIL,
  })
  preferredChannel: ContactPreferredChannel;

  // Client portal access. When enabled, this contact can log into the portal
  // with its email + password and only ever sees this customer's tickets.
  @Column({ name: 'portal_enabled', type: 'boolean', default: false })
  portalEnabled: boolean;

  @Column({ name: 'portal_password_hash', type: 'varchar', length: 255, nullable: true, select: false })
  portalPasswordHash: string | null;

  // Original Zammad Argon2id hash for this customer user, kept until they log
  // into the portal successfully (lazy migration to portalPasswordHash bcrypt).
  @Column({ name: 'legacy_argon2_hash', type: 'text', nullable: true, select: false })
  legacyArgon2Hash: string | null;

  // Estado de la conversación de WhatsApp del bot (menú de bienvenida). Null si no
  // hay conversación de WhatsApp en curso. Guarda `{ state, messages }`:
  //  - state: 'awaiting_option' | 'awaiting_option_retry' | null
  //  - messages: historial pendiente de backfill al ticket cuando se crea.
  @Column({ name: 'whatsapp_menu_state', type: 'jsonb', nullable: true })
  whatsappMenuState: { state: string | null; messages: Array<{ author: 'cliente' | 'bot'; body: string }> } | null;

  // Registro de cuenta en el portal. La cuenta queda bloqueada (no puede
  // loguearse) hasta que verifica el email; el vínculo por dominio corre en la
  // confirmación, no en el registro.
  @Column({ name: 'email_verified_at', type: 'timestamptz', nullable: true })
  emailVerifiedAt: Date | null;

  // Hash SHA-256 del token de verificación de email (nunca el token en claro).
  @Column({ name: 'email_verification_token_hash', type: 'varchar', length: 64, nullable: true })
  emailVerificationTokenHash: string | null;

  @Column({ name: 'email_verification_expires_at', type: 'timestamptz', nullable: true })
  emailVerificationExpiresAt: Date | null;
}
