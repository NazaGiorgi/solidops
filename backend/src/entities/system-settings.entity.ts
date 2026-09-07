import { Column, Entity } from 'typeorm';
import { BaseEntity } from '../common/entities/base.entity';
import { BusinessHours } from '../common/utils/business-hours.util';

// Single-row (by convention) system configuration. Holds globally-applicable
// values that were previously hardcoded in the code (company name, default
// business hours, default SLA fallback targets, contact/sender email). Read at
// runtime by SLA computation and branding, so edits apply without a restart.
// Implemented as a single key-value row with fixed columns for simplicity; the
// app uses the first row (a singleton).
@Entity('system_settings')
export class SystemSettings extends BaseEntity {
  @Column({ type: 'varchar', length: 160, default: 'SolidOps' })
  companyName: string;

  // Default business hours (same shape as Contract.business_hours) used for SLA
  // when a ticket has no active contract. Empty {} = 24/7.
  @Column({ name: 'business_hours', type: 'jsonb', default: {} })
  businessHours: BusinessHours;

  // Default SLA fallback targets for customers without a contract.
  @Column({ name: 'sla_first_response_minutes', type: 'int', default: 60 })
  slaFirstResponseMinutes: number;

  @Column({ name: 'sla_resolution_hours', type: 'int', default: 8 })
  slaResolutionHours: number;

  // General contact email / default sender for system notifications.
  @Column({ name: 'contact_email', type: 'varchar', length: 160, nullable: true })
  contactEmail: string | null;

  // "Modo acumulación" toggle: while SolidOps coexists with Zammad, incoming
  // emails become full tickets (contact, thread, SLA) but NO outbound email is
  // sent to the sender. When false (default) nothing goes out; when true the
  // platform may send auto-responses / status notifications to customers.
  // Temporary + reversible: flip this from the Administration panel when the
  // Zammad cutover happens and outbound templates are ready.
  @Column({ name: 'email_auto_response_enabled', type: 'boolean', default: false })
  emailAutoResponseEnabled: boolean;

  // Default outbound sender address used for customer-facing emails (used when
  // auto-response is enabled). Null until configured.
  @Column({ name: 'email_sender', type: 'varchar', length: 160, nullable: true })
  emailSender: string | null;
}
